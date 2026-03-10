/**
 * Web Worker that runs the celsp WASM language server.
 *
 * Receives JSON-RPC LSP requests from the main thread via postMessage,
 * delegates them to the CelAnalyzer WASM module, and sends responses back.
 *
 * The worker expects a `{ type: "celsp/init", options }` message before
 * any JSON-RPC traffic. The options are forwarded to `CelAnalyzer::new()`.
 */

import init, { CelAnalyzer } from "../crates/celsp/pkg/celsp.js";

let analyzer: CelAnalyzer | null = null;

/**
 * Initialize the WASM module and create the CelAnalyzer instance.
 * Waits for the init message carrying analyzer options.
 */
const ready = new Promise<void>((resolve) => {
  const onInit = async (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.type !== "celsp/init") return;

    self.removeEventListener("message", onInit);

    await init();
    analyzer = new CelAnalyzer(JSON.stringify(msg.options ?? {}));

    resolve();
  };

  self.addEventListener("message", onInit);
});

// ─── Message listener ───────────────────────────────────────────────────────

self.addEventListener("message", async (event: MessageEvent) => {
  // Ensure WASM is initialized before handling any requests.
  await ready;

  const message = event.data;

  // Ignore our own init message (already handled above).
  if (message?.type === "celsp/init") return;

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

    // Proactively push semantic tokens alongside diagnostics so that the
    // highlight extension doesn't need to make a separate request that
    // races with didOpen.
    if (
      message.method === "textDocument/didOpen" ||
      message.method === "textDocument/didChange"
    ) {
      const uri =
        message.params?.textDocument?.uri ?? "file:///cel.cel";
      const tokensJson = analyzer!.semantic_tokens(uri);
      if (tokensJson && tokensJson !== "null") {
        const tokens = JSON.parse(tokensJson);
        self.postMessage({
          jsonrpc: "2.0",
          method: "celsp/semanticTokens",
          params: { uri, tokens },
        });
      }
    }
    return;
  }

  // Regular JSON-RPC response.
  if (response.id != null || message.id != null) {
    self.postMessage(response);
  }
});
