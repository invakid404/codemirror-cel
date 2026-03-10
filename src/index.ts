import { LanguageServerClient, languageServerWithClient } from "@marimo-team/codemirror-languageserver";
import type { Extension } from "@codemirror/state";
import { WorkerTransport } from "./transport.ts";

// ─── Public configuration ───────────────────────────────────────────────────

export interface CelConfig {
  /** A Web Worker running the celsp WASM language server. */
  worker: Worker;

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
 * const worker = new Worker(
 *   new URL("codemirror-cel/worker", import.meta.url),
 *   { type: "module" },
 * );
 * const extensions = [
 *   ...(await cel({ worker })),
 * ];
 * ```
 */
export async function cel(config: CelConfig): Promise<Extension[]> {
  const {
    worker,
    rootUri = "file:///",
    documentUri = "file:///cel.cel",
    languageId = "cel",
  } = config;

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
