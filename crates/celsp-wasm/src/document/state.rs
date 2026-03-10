//! Document state management for the CEL LSP (WASM version).
//!
//! Adapted from celsp's document/state.rs.
//! Changes:
//!   - Removed DashMap-based DocumentStore (state managed on JS side)
//!   - Removed ProtoDocumentState (proto support skipped for v1)
//!   - Removed DocumentKind enum (only CEL documents supported)
//!   - Removed cel_core_proto and tower_lsp imports
//!   - Removed async code
//!   - Removed protovalidate references

use std::sync::Arc;

use cel_core::{parse, CheckError, CheckResult, Env, ParseError, SpannedExpr};

use super::text::LineIndex;

/// State for a single CEL document.
///
/// Holds the parsed AST, type-check results, and everything needed
/// for LSP features (completion, diagnostics, hover, semantic tokens).
#[derive(Debug, Clone)]
pub struct DocumentState {
    /// Pre-computed line index for position conversion.
    pub line_index: LineIndex,
    /// The parsed AST (may be partial with Expr::Error nodes).
    pub ast: Option<SpannedExpr>,
    /// Any parse errors encountered.
    pub errors: Vec<ParseError>,
    /// Check result from type checking (contains errors and type info).
    pub check_result: Option<CheckResult>,
    /// Document version from the client.
    pub version: i32,
    /// The original source text (needed for completion re-parsing).
    pub source: String,
    /// The environment used for type checking (needed for completion).
    pub env: Arc<Env>,
}

impl DocumentState {
    /// Create a new document state by parsing and type-checking the source
    /// with the default CEL standard library environment.
    pub fn new(source: String, version: i32) -> Self {
        let env = Arc::new(Env::with_standard_library().with_all_extensions());
        Self::with_env(source, version, env)
    }

    /// Create a new document state with a custom Env.
    pub fn with_env(source: String, version: i32, env: Arc<Env>) -> Self {
        let result = parse(&source);
        let line_index = LineIndex::new(source.clone());

        // Run type checking if we have an AST
        let check_result = result.ast.as_ref().map(|ast| env.check(ast));

        Self {
            line_index,
            ast: result.ast,
            errors: result.errors,
            check_result,
            version,
            source,
            env,
        }
    }

    /// Get the AST if available.
    /// Note: The AST may contain Expr::Error nodes if there were parse errors.
    pub fn ast(&self) -> Option<&SpannedExpr> {
        self.ast.as_ref()
    }

    /// Get the check errors if any.
    pub fn check_errors(&self) -> &[CheckError] {
        self.check_result
            .as_ref()
            .map(|r| r.errors.as_slice())
            .unwrap_or(&[])
    }
}
