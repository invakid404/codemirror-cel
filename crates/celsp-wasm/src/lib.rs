//! CEL Language Server compiled to WebAssembly.
//!
//! This crate adapts the core logic from the `celsp` CEL Language Server
//! into a WASM module for use in browsers. It exposes a `CelAnalyzer` struct
//! via wasm-bindgen that implements LSP request handlers.
//!
//! The transport layer (tower-lsp, tokio) is replaced by a simple JSON-RPC
//! dispatch mechanism that the Web Worker calls directly.

use std::collections::HashMap;
use std::sync::Arc;

use cel_core::Env;
use lsp_types::*;
use serde_json::Value;
use wasm_bindgen::prelude::*;

mod document;
mod lsp;
pub(crate) mod types;

use document::DocumentState;

/// CEL expression analyzer exposed to JavaScript via wasm-bindgen.
///
/// Holds the CEL environment and per-document state. The JS side creates
/// one instance and calls methods on it for each LSP request.
#[wasm_bindgen]
pub struct CelAnalyzer {
    /// The CEL type-checking environment (standard library + extensions).
    env: Arc<Env>,
    /// Open documents keyed by URI string.
    documents: HashMap<String, DocumentState>,
}

#[wasm_bindgen]
impl CelAnalyzer {
    /// Create a new CelAnalyzer with the default CEL standard library environment.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            env: Arc::new(Env::with_standard_library().with_all_extensions()),
            documents: HashMap::new(),
        }
    }

    /// Handle an LSP JSON-RPC request. Takes a JSON string, returns a JSON string.
    ///
    /// This is the main entry point called from the Web Worker. It parses the
    /// JSON-RPC request, dispatches to the appropriate handler based on the
    /// `method` field, and returns the JSON-RPC response.
    pub fn handle_request(&mut self, json: &str) -> String {
        let request: Value = match serde_json::from_str(json) {
            Ok(v) => v,
            Err(e) => {
                return self.json_rpc_error(None, -32700, &format!("Parse error: {}", e));
            }
        };

        let id = request.get("id").cloned();
        let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = request.get("params").cloned().unwrap_or(Value::Null);

        match method {
            "initialize" => self.handle_initialize(id),
            "initialized" => self.handle_initialized(),
            "textDocument/didOpen" => self.handle_did_open(&params),
            "textDocument/didChange" => self.handle_did_change(&params),
            "textDocument/completion" => self.handle_completion(id, &params),
            "textDocument/hover" => self.handle_hover(id, &params),
            "textDocument/semanticTokens/full" => self.handle_semantic_tokens(id, &params),
            "shutdown" => self.json_rpc_response(id, Value::Null),
            "exit" => self.json_rpc_response(id, Value::Null),
            _ => self.json_rpc_error(id, -32601, &format!("Method not found: {}", method)),
        }
    }

    /// Handle document open — parses and type-checks, returns diagnostics as JSON.
    pub fn did_open(&mut self, uri: &str, text: &str) -> String {
        let state = DocumentState::with_env(text.to_string(), 0, Arc::clone(&self.env));
        let diagnostics =
            lsp::to_diagnostics(&state.errors, state.check_errors(), &state.line_index);
        self.documents.insert(uri.to_string(), state);

        serde_json::to_string(&diagnostics).unwrap_or_else(|_| "[]".to_string())
    }

    /// Handle document change — re-parses and type-checks, returns diagnostics as JSON.
    pub fn did_change(&mut self, uri: &str, text: &str) -> String {
        // Same as did_open — we use full sync mode
        self.did_open(uri, text)
    }

    /// Get completions at position — returns JSON.
    pub fn completion(&self, uri: &str, line: u32, character: u32) -> String {
        let Some(state) = self.documents.get(uri) else {
            return "null".to_string();
        };

        let position = Position::new(line, character);
        let result =
            lsp::completion_at_position(&state.line_index, &state.source, &state.env, position);

        serde_json::to_string(&result).unwrap_or_else(|_| "null".to_string())
    }

    /// Get hover info at position — returns JSON.
    pub fn hover(&self, uri: &str, line: u32, character: u32) -> String {
        let Some(state) = self.documents.get(uri) else {
            return "null".to_string();
        };

        let position = Position::new(line, character);
        let ast = match state.ast() {
            Some(ast) => ast,
            None => return "null".to_string(),
        };

        let result = lsp::hover_at_position(
            &state.line_index,
            ast,
            state.check_result.as_ref(),
            position,
        );

        serde_json::to_string(&result).unwrap_or_else(|_| "null".to_string())
    }

    /// Get semantic tokens for document — returns JSON.
    pub fn semantic_tokens(&self, uri: &str) -> String {
        let Some(state) = self.documents.get(uri) else {
            return "null".to_string();
        };

        let ast = match state.ast() {
            Some(ast) => ast,
            None => return "null".to_string(),
        };

        let tokens = lsp::tokens_for_ast(&state.line_index, ast);
        let result = SemanticTokensResult::Tokens(SemanticTokens {
            result_id: None,
            data: tokens,
        });

        serde_json::to_string(&result).unwrap_or_else(|_| "null".to_string())
    }
}

// Private helper methods for JSON-RPC handling.
impl CelAnalyzer {
    /// Handle `initialize` — return server capabilities.
    fn handle_initialize(&self, id: Option<Value>) -> String {
        let capabilities = InitializeResult {
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::FULL,
                )),
                hover_provider: Some(HoverProviderCapability::Simple(true)),
                completion_provider: Some(CompletionOptions {
                    trigger_characters: Some(vec![".".to_string()]),
                    resolve_provider: Some(false),
                    ..Default::default()
                }),
                semantic_tokens_provider: Some(
                    SemanticTokensServerCapabilities::SemanticTokensOptions(
                        SemanticTokensOptions {
                            legend: lsp::legend(),
                            full: Some(SemanticTokensFullOptions::Bool(true)),
                            range: None,
                            work_done_progress_options: WorkDoneProgressOptions::default(),
                        },
                    ),
                ),
                ..Default::default()
            },
            ..Default::default()
        };

        let result = serde_json::to_value(&capabilities).unwrap_or(Value::Null);
        self.json_rpc_response(id, result)
    }

    /// Handle `initialized` — no-op, return empty notification response.
    fn handle_initialized(&self) -> String {
        // Notifications have no id and no response is expected,
        // but we return an empty string to signal success.
        String::new()
    }

    /// Handle `textDocument/didOpen`.
    fn handle_did_open(&mut self, params: &Value) -> String {
        let uri = params
            .pointer("/textDocument/uri")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let text = params
            .pointer("/textDocument/text")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let version = params
            .pointer("/textDocument/version")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;

        let state = DocumentState::with_env(text.to_string(), version, Arc::clone(&self.env));
        let diagnostics =
            lsp::to_diagnostics(&state.errors, state.check_errors(), &state.line_index);
        self.documents.insert(uri.to_string(), state);

        // Return a publishDiagnostics notification
        self.diagnostics_notification(uri, &diagnostics)
    }

    /// Handle `textDocument/didChange`.
    fn handle_did_change(&mut self, params: &Value) -> String {
        let uri = params
            .pointer("/textDocument/uri")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let version = params
            .pointer("/textDocument/version")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;

        // Full sync mode — take the first (only) content change
        let text = params
            .pointer("/contentChanges/0/text")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let state = DocumentState::with_env(text.to_string(), version, Arc::clone(&self.env));
        let diagnostics =
            lsp::to_diagnostics(&state.errors, state.check_errors(), &state.line_index);
        self.documents.insert(uri.to_string(), state);

        self.diagnostics_notification(uri, &diagnostics)
    }

    /// Handle `textDocument/completion`.
    fn handle_completion(&self, id: Option<Value>, params: &Value) -> String {
        let uri = params
            .pointer("/textDocument/uri")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let line = params
            .pointer("/position/line")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let character = params
            .pointer("/position/character")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        let Some(state) = self.documents.get(uri) else {
            return self.json_rpc_response(id, Value::Null);
        };

        let position = Position::new(line, character);
        let result =
            lsp::completion_at_position(&state.line_index, &state.source, &state.env, position);

        let value = serde_json::to_value(&result).unwrap_or(Value::Null);
        self.json_rpc_response(id, value)
    }

    /// Handle `textDocument/hover`.
    fn handle_hover(&self, id: Option<Value>, params: &Value) -> String {
        let uri = params
            .pointer("/textDocument/uri")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let line = params
            .pointer("/position/line")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let character = params
            .pointer("/position/character")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        let Some(state) = self.documents.get(uri) else {
            return self.json_rpc_response(id, Value::Null);
        };

        let position = Position::new(line, character);
        let result = match state.ast() {
            Some(ast) => lsp::hover_at_position(
                &state.line_index,
                ast,
                state.check_result.as_ref(),
                position,
            ),
            None => None,
        };

        let value = serde_json::to_value(&result).unwrap_or(Value::Null);
        self.json_rpc_response(id, value)
    }

    /// Handle `textDocument/semanticTokens/full`.
    fn handle_semantic_tokens(&self, id: Option<Value>, params: &Value) -> String {
        let uri = params
            .pointer("/textDocument/uri")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let Some(state) = self.documents.get(uri) else {
            return self.json_rpc_response(id, Value::Null);
        };

        let result = match state.ast() {
            Some(ast) => {
                let tokens = lsp::tokens_for_ast(&state.line_index, ast);
                Some(SemanticTokensResult::Tokens(SemanticTokens {
                    result_id: None,
                    data: tokens,
                }))
            }
            None => None,
        };

        let value = serde_json::to_value(&result).unwrap_or(Value::Null);
        self.json_rpc_response(id, value)
    }

    /// Build a JSON-RPC response string.
    fn json_rpc_response(&self, id: Option<Value>, result: Value) -> String {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        });
        serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string())
    }

    /// Build a JSON-RPC error response string.
    fn json_rpc_error(&self, id: Option<Value>, code: i32, message: &str) -> String {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": code,
                "message": message,
            },
        });
        serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string())
    }

    /// Build a publishDiagnostics notification JSON string.
    fn diagnostics_notification(&self, uri: &str, diagnostics: &[Diagnostic]) -> String {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": uri,
                "diagnostics": diagnostics,
            },
        });
        serde_json::to_string(&notification).unwrap_or_else(|_| "{}".to_string())
    }
}
