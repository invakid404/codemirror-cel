import { LanguageServerClient, languageServerWithClient } from "@marimo-team/codemirror-languageserver";
import type { Extension } from "@codemirror/state";
import { WorkerTransport } from "./transport.ts";

// ─── Public configuration ───────────────────────────────────────────────────

export interface CelConfig {
  /** URL to the celsp WASM module. */
  wasmUrl: string;

  /** Root URI for the LSP workspace. Defaults to "file:///". */
  rootUri?: string;

  /** URI for the document being edited. Defaults to "file:///cel.cel". */
  documentUri?: string;

  /** Language ID sent to the LSP server. Defaults to "cel". */
  languageId?: string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a CodeMirror extension for CEL language support.
 *
 * Spawns a Web Worker that runs the celsp WASM language server and
 * connects it to CodeMirror via the @marimo-team/codemirror-languageserver
 * plugin.
 *
 * @example
 * ```ts
 * import { cel } from "codemirror-cel";
 *
 * const extensions = [
 *   ...(await cel({ wasmUrl: "/wasm/celsp.wasm" })),
 * ];
 * ```
 */
export async function cel(config: CelConfig): Promise<Extension[]> {
  const {
    rootUri = "file:///",
    documentUri = "file:///cel.cel",
    languageId = "cel",
  } = config;

  // Create a Web Worker from the worker module.
  // The `new URL(...)` pattern is recognized by bundlers (webpack, vite, esbuild)
  // for proper asset handling and code splitting.
  const worker = new Worker(
    new URL("./worker.ts", import.meta.url),
    { type: "module" },
  );

  // Create the transport that bridges postMessage ↔ JSON-RPC.
  const transport = new WorkerTransport(worker);
  await transport.connect();

  // Create the LSP client.
  const client = new LanguageServerClient({
    rootUri,
    workspaceFolders: null,
    transport,
  });

  // Wait for the LSP initialization handshake to complete.
  await client.initializePromise;

  // Build and return the CodeMirror extension array.
  return languageServerWithClient({
    client,
    documentUri,
    languageId,
  });
}

// ─── Re-exports for advanced usage ──────────────────────────────────────────

export { WorkerTransport } from "./transport.ts";
export type { CelConfig as CelLanguageConfig };
