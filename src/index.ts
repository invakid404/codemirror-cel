import { LanguageServerClient, languageServerWithClient } from "@marimo-team/codemirror-languageserver";
import type { Extension } from "@codemirror/state";
import { WorkerTransport } from "./transport.ts";
import { celSemanticHighlighting } from "./highlight.ts";
import type { AnalyzerOptions, FunctionDeclaration, VariableDeclaration } from "./types.ts";

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

  /** Variable declarations available in the CEL environment. */
  variables?: VariableDeclaration[];

  /** Function declarations (type signatures only) for the CEL type-checker. */
  functions?: FunctionDeclaration[];

  /**
   * Whether hover tooltips should include check-error details.
   *
   * Defaults to `false` because CM6 already shows diagnostics in the
   * tooltip — displaying both produces duplicate error messages.
   */
  hoverShowErrors?: boolean;
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
 *   ...(await cel({ worker, variables: [{ name: "x", type: "int" }] })),
 * ];
 * ```
 */
export async function cel(config: CelConfig): Promise<Extension[]> {
  const {
    worker,
    rootUri = "file:///",
    documentUri = "file:///cel.cel",
    languageId = "cel",
    variables,
    functions,
    hoverShowErrors = false,
  } = config;

  // Build analyzer options and send to the worker before connecting
  // the LSP transport. The worker waits for this message before
  // constructing the CelAnalyzer.
  const analyzerOptions: AnalyzerOptions = {
    variables,
    functions,
    hoverShowErrors,
  };
  worker.postMessage({ type: "celsp/init", options: analyzerOptions });

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
    // Tokens are styled by whatever HighlightStyle the consumer has active.
    ...celSemanticHighlighting(worker, documentUri),
  ];
}

// ─── Re-exports for advanced usage ──────────────────────────────────────────

export { WorkerTransport } from "./transport.ts";
export type { CelConfig as CelLanguageConfig };
export type {
  AnalyzerOptions,
  FunctionDeclaration,
  VariableDeclaration,
  CELType,
  CELTypeDef,
  CELListType,
  CELMapType,
  CELFunctionParam,
} from "./types.ts";
