/**
 * Web Worker that acts as a JSON-RPC server for the CEL Language Server
 * Protocol. It receives JSON-RPC requests from the main thread via
 * postMessage and sends responses back.
 *
 * Eventually, this worker will load the celsp WASM module and delegate
 * language operations to it. For now, it implements the minimal LSP
 * lifecycle and stubs for content methods.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

// ─── WASM module placeholder ────────────────────────────────────────────────

// TODO: Load and initialize the celsp WASM module here.
// Example:
//   const wasmModule = await WebAssembly.instantiateStreaming(fetch(wasmUrl));
//   const celsp = wasmModule.instance.exports;

// ─── LSP Server Capabilities ───────────────────────────────────────────────

const SERVER_CAPABILITIES = {
  /** Full document sync — client sends entire document on each change. */
  textDocumentSync: 1,
  /** Completion support with "." as a trigger character. */
  completionProvider: {
    triggerCharacters: ["."],
  },
  /** Hover information support. */
  hoverProvider: true,
  // Diagnostics are pushed via textDocument/publishDiagnostics notification.
};

// ─── Document store ─────────────────────────────────────────────────────────

/** In-memory store of open documents, keyed by URI. */
const documents = new Map<string, string>();

// ─── Request handling ───────────────────────────────────────────────────────

/**
 * Dispatch a JSON-RPC request to the appropriate handler.
 * Returns the result value for the response, or throws an error
 * with { code, message } for JSON-RPC error responses.
 */
function handleRequest(
  method: string,
  params: Record<string, unknown> | unknown[] | undefined,
): unknown {
  switch (method) {
    // ── LSP lifecycle ─────────────────────────────────────────────────
    case "initialize":
      return {
        capabilities: SERVER_CAPABILITIES,
        serverInfo: {
          name: "celsp-wasm",
          version: "0.1.0",
        },
      };

    case "shutdown":
      return null;

    // ── Text document synchronization ─────────────────────────────────
    case "textDocument/didOpen": {
      const p = params as Record<string, any>;
      const textDocument = p.textDocument as {
        uri: string;
        text: string;
      };
      documents.set(textDocument.uri, textDocument.text);
      // After opening, schedule a diagnostic check.
      scheduleDiagnostics(textDocument.uri);
      return undefined; // notification — no response needed
    }

    case "textDocument/didChange": {
      const p = params as Record<string, any>;
      const uri = (p.textDocument as { uri: string }).uri;
      const changes = p.contentChanges as { text: string }[];
      // With full sync (textDocumentSync: 1), the last change contains
      // the full document text.
      const lastChange = changes[changes.length - 1];
      if (lastChange) {
        documents.set(uri, lastChange.text);
      }
      scheduleDiagnostics(uri);
      return undefined; // notification
    }

    case "textDocument/didClose": {
      const p = params as Record<string, any>;
      const uri = (p.textDocument as { uri: string }).uri;
      documents.delete(uri);
      return undefined; // notification
    }

    // ── Content methods (stubs) ───────────────────────────────────────

    case "textDocument/completion": {
      // TODO: Call into WASM module for real completions.
      return { isIncomplete: false, items: [] };
    }

    case "textDocument/hover": {
      // TODO: Call into WASM module for hover info.
      return null;
    }

    case "textDocument/definition": {
      // TODO: Call into WASM module for go-to-definition.
      return null;
    }

    case "textDocument/signatureHelp": {
      // TODO: Call into WASM module for signature help.
      return null;
    }

    case "textDocument/codeAction": {
      // TODO: Call into WASM module for code actions.
      return [];
    }

    default:
      throw { code: -32601, message: `Method not found: ${method}` };
  }
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

let diagnosticsTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a diagnostics push for the given document URI.
 * Debounced to avoid excessive computation on rapid edits.
 */
function scheduleDiagnostics(uri: string) {
  if (diagnosticsTimer !== null) {
    clearTimeout(diagnosticsTimer);
  }
  diagnosticsTimer = setTimeout(() => {
    diagnosticsTimer = null;
    pushDiagnostics(uri);
  }, 200);
}

/**
 * Compute and push diagnostics for a document.
 * Sends a textDocument/publishDiagnostics notification to the main thread.
 */
function pushDiagnostics(uri: string) {
  // TODO: Call into WASM module for real diagnostics.
  const _content = documents.get(uri);

  const diagnostics: unknown[] = [];

  sendNotification("textDocument/publishDiagnostics", {
    uri,
    diagnostics,
  });
}

// ─── JSON-RPC message handling ──────────────────────────────────────────────

/**
 * Send a JSON-RPC response back to the main thread.
 */
function sendResponse(id: number | string | null, result: unknown): void {
  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    id,
    result,
  };
  self.postMessage(response);
}

/**
 * Send a JSON-RPC error response back to the main thread.
 */
function sendError(
  id: number | string | null,
  code: number,
  message: string,
): void {
  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
  self.postMessage(response);
}

/**
 * Send a server-initiated JSON-RPC notification to the main thread.
 */
function sendNotification(
  method: string,
  params: Record<string, unknown>,
): void {
  const notification: JsonRpcNotification = {
    jsonrpc: "2.0",
    method,
    params,
  };
  self.postMessage(notification);
}

// ─── Message listener ───────────────────────────────────────────────────────

self.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as JsonRpcRequest;

  // Validate basic JSON-RPC structure.
  if (!message || message.jsonrpc !== "2.0" || !message.method) {
    if (message?.id != null) {
      sendError(message.id, -32600, "Invalid JSON-RPC request");
    }
    return;
  }

  const { id, method, params } = message;

  // Handle "exit" — terminates the worker.
  if (method === "exit") {
    self.close();
    return;
  }

  // Handle "initialized" notification — no response needed.
  if (method === "initialized") {
    return;
  }

  try {
    const result = handleRequest(method, params);

    // Notifications (no id) don't get a response.
    if (id != null && result !== undefined) {
      sendResponse(id, result);
    } else if (id != null) {
      // Methods like shutdown return null explicitly.
      sendResponse(id, null);
    }
  } catch (err: unknown) {
    const rpcError = err as { code?: number; message?: string };
    if (id != null) {
      sendError(
        id,
        rpcError.code ?? -32603,
        rpcError.message ?? "Internal error",
      );
    }
  }
});
