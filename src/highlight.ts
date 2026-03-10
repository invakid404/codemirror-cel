/**
 * Semantic token highlighting for CEL.
 *
 * Requests semantic tokens from the celsp WASM worker and applies
 * CodeMirror Decorations directly — bypassing the LSP client which
 * doesn't support semantic tokens.
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { RangeSetBuilder } from "@codemirror/state";

// ─── Token type → CSS class mapping ────────────────────────────────────────

/** Matches the legend order in semantic_tokens.rs */
const TOKEN_CLASSES: Record<number, string> = {
  0: "cmt-keyword",      // keyword (true, false, null)
  1: "cmt-number",       // number
  2: "cmt-string",       // string
  3: "cmt-operator",     // operator
  4: "cmt-variableName", // variable
  5: "cmt-function",     // function
  6: "cmt-method",       // method
  7: "cmt-punctuation",  // punctuation
};

// ─── State management ──────────────────────────────────────────────────────

interface SemanticTokenData {
  delta_line: number;
  delta_start: number;
  length: number;
  token_type: number;
  token_modifiers_bitset: number;
}

const setTokens = StateEffect.define<DecorationSet>();

const tokenDecorations = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTokens)) return effect.value;
    }
    // Map positions through document changes
    if (tr.docChanged) return value.map(tr.changes);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ─── Build decorations from LSP semantic tokens ────────────────────────────

function buildDecorations(
  tokens: SemanticTokenData[],
  doc: { lineAt(n: number): { from: number }; line(n: number): { from: number } },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const marks: { from: number; to: number; cls: string }[] = [];

  let line = 0;
  let char = 0;

  for (const token of tokens) {
    line += token.delta_line;
    if (token.delta_line > 0) {
      char = token.delta_start;
    } else {
      char += token.delta_start;
    }

    const cls = TOKEN_CLASSES[token.token_type];
    if (!cls) continue;

    // LSP lines are 0-indexed, CodeMirror lines are 1-indexed
    const lineInfo = doc.line(line + 1);
    const from = lineInfo.from + char;
    const to = from + token.length;

    // Add defaultLibrary modifier class
    const fullCls =
      token.token_modifiers_bitset & 1
        ? `${cls} cmt-standard`
        : cls;

    marks.push({ from, to, cls: fullCls });
  }

  // RangeSetBuilder requires sorted ranges
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const { from, to, cls } of marks) {
    builder.add(from, to, Decoration.mark({ class: cls }));
  }

  return builder.finish();
}

// ─── View plugin that requests tokens from the worker ──────────────────────

function semanticHighlightPlugin(worker: Worker) {
  let pending = false;
  let generation = 0;

  return ViewPlugin.fromClass(
    class {
      constructor(private view: EditorView) {
        this.requestTokens();
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.requestTokens();
        }
      }

      private requestTokens() {
        generation++;
        const gen = generation;

        // Debounce
        if (pending) return;
        pending = true;

        setTimeout(() => {
          pending = false;
          if (gen !== generation) {
            // Doc changed again, skip this request
            this.requestTokens();
            return;
          }
          this.doRequest(gen);
        }, 100);
      }

      private doRequest(gen: number) {
        const id = `sem-${gen}`;
        const uri = "file:///cel.cel";

        const handler = (event: MessageEvent) => {
          const msg = event.data;
          if (msg?.id !== id) return;
          worker.removeEventListener("message", handler);

          if (gen !== generation) return;

          const result = msg.result;
          if (!result?.data) return;

          const tokens: SemanticTokenData[] = result.data;
          const decorations = buildDecorations(tokens, this.view.state.doc);
          this.view.dispatch({ effects: setTokens.of(decorations) });
        };

        worker.addEventListener("message", handler);
        worker.postMessage({
          jsonrpc: "2.0",
          id,
          method: "textDocument/semanticTokens/full",
          params: { textDocument: { uri } },
        });
      }

      destroy() {}
    },
  );
}

// ─── Default theme for semantic tokens ─────────────────────────────────────

const semanticTheme = EditorView.baseTheme({
  ".cmt-keyword": { color: "#c678dd" },
  ".cmt-number": { color: "#d19a66" },
  ".cmt-string": { color: "#98c379" },
  ".cmt-operator": { color: "#56b6c2" },
  ".cmt-variableName": { color: "#e06c75" },
  ".cmt-function": { color: "#61afef" },
  ".cmt-method": { color: "#61afef" },
  ".cmt-punctuation": { color: "#abb2bf" },
  ".cmt-standard": { fontStyle: "italic" },
});

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Create a CodeMirror extension for CEL semantic token highlighting.
 * Communicates directly with the worker to request tokens.
 */
export function celSemanticHighlighting(worker: Worker) {
  return [tokenDecorations, semanticHighlightPlugin(worker), semanticTheme];
}
