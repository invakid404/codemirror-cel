import { LanguageServerClient, languageServerWithClient } from "@marimo-team/codemirror-languageserver";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { WorkerTransport } from "./transport.ts";
import { celSemanticHighlighting } from "./highlight.ts";

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
  const lspExtensions = languageServerWithClient({
    client,
    documentUri,
    languageId,
    allowHTMLContent: true,
    useSnippetOnCompletion: true,
    // Our WASM server uses full document sync (TextDocumentSyncKind::FULL).
    // The CM LSP plugin defaults to incremental changes, which causes the
    // server to treat partial change text as the entire document.
    sendIncrementalChanges: false,
  });

  return [
    ...lspExtensions,
    // Semantic token highlighting — talks to the worker directly since
    // @marimo-team/codemirror-languageserver doesn't support semantic tokens.
    ...celSemanticHighlighting(worker),
    // Dark theme for autocomplete & tooltip UI
    lspTooltipTheme,
  ];
}

// ─── Dark theme for LSP tooltips & autocomplete ────────────────────────────

const lspTooltipTheme = EditorView.theme({
  // Autocomplete dropdown
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "#1e1e1e",
    border: "1px solid #3c3c3c",
    color: "#d4d4d4",
  },
  ".cm-tooltip-autocomplete ul li": {
    color: "#d4d4d4",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "#094771",
    color: "#ffffff",
  },
  ".cm-completionDetail": {
    color: "#9d9d9d",
    fontStyle: "italic",
  },
  // Documentation tooltip (info panel next to autocomplete)
  ".cm-completionInfo": {
    backgroundColor: "#252526",
    border: "1px solid #3c3c3c",
    color: "#d4d4d4",
  },
  ".cm-completionInfo .documentation": {
    color: "#d4d4d4",
  },
  ".cm-completionInfo .documentation p": {
    color: "#d4d4d4",
  },
  ".cm-completionInfo .documentation code": {
    backgroundColor: "#1e1e1e",
    color: "#ce9178",
    padding: "1px 4px",
    borderRadius: "3px",
  },
  // Hover & diagnostic tooltips
  ".cm-tooltip": {
    backgroundColor: "#252526",
    border: "1px solid #3c3c3c",
    color: "#d4d4d4",
  },
  ".cm-tooltip code": {
    backgroundColor: "#1e1e1e",
    color: "#ce9178",
  },
  ".cm-lsp-hover-tooltip": {
    color: "#d4d4d4",
  },
});

// ─── Re-exports for advanced usage ──────────────────────────────────────────

export { WorkerTransport } from "./transport.ts";
export type { CelConfig as CelLanguageConfig };
