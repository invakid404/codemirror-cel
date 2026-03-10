/**
 * Web Worker that runs the celsp WASM language server.
 *
 * Receives JSON-RPC LSP requests from the main thread via postMessage,
 * delegates them to the CelAnalyzer WASM module, and sends responses back.
 */

import init, { CelAnalyzer } from "../crates/celsp-wasm/pkg/celsp_wasm.js";

let analyzer: CelAnalyzer | null = null;

/**
 * Initialize the WASM module and create the CelAnalyzer instance.
 * Called once when the worker starts.
 */
async function initialize(): Promise<void> {
  await init();
  analyzer = new CelAnalyzer();
}

const ready = initialize();

// ─── Message listener ───────────────────────────────────────────────────────

self.addEventListener("message", async (event: MessageEvent) => {
  // Ensure WASM is initialized before handling any requests.
  await ready;

  const message = event.data;

  // Validate basic JSON-RPC structure.
  if (!message || message.jsonrpc !== "2.0" || !message.method) {
    if (message?.id != null) {
      self.postMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32600, message: "Invalid JSON-RPC request" },
      });
    }
    return;
  }

  // "initialized" is a notification — no response needed, no dispatch.
  if (message.method === "initialized") {
    return;
  }

  // Delegate to the WASM module's JSON-RPC handler.
  const responseJson = analyzer!.handle_request(JSON.stringify(message));

  // The WASM module returns an empty string for notifications (no response expected).
  if (!responseJson) {
    return;
  }

  const response = JSON.parse(responseJson);

  // For didOpen/didChange, the WASM module returns a publishDiagnostics notification
  // (it has a "method" field instead of an "id" field).
  if (response.method) {
    // Server-initiated notification — send it to the main thread.
    self.postMessage(response);
    return;
  }

  // Regular JSON-RPC response.
  if (response.id != null || message.id != null) {
    self.postMessage(response);
  }
});
