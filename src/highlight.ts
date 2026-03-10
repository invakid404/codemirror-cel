/**
 * Semantic token highlighting for CEL.
 *
 * Listens for `celsp/semanticTokens` notifications pushed by the worker
 * (sent proactively after didOpen/didChange) and applies CodeMirror
 * Decorations — bypassing the LSP client which doesn't support semantic tokens.
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
  deltaLine: number;
  deltaStart: number;
  length: number;
  tokenType: number;
  tokenModifiersBitset: number;
}

/**
 * Decode the flat u32[] wire format into structured token objects.
 *
 * lsp_types serializes SemanticTokens.data as a flat sequence of u32
 * values (groups of 5): [deltaLine, deltaStart, length, tokenType, modifiers, ...]
 */
function decodeTokenData(data: number[]): SemanticTokenData[] {
  const tokens: SemanticTokenData[] = [];
  for (let i = 0; i + 4 < data.length; i += 5) {
    tokens.push({
      deltaLine: data[i]!,
      deltaStart: data[i + 1]!,
      length: data[i + 2]!,
      tokenType: data[i + 3]!,
      tokenModifiersBitset: data[i + 4]!,
    });
  }
  return tokens;
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
  doc: { line(n: number): { from: number } },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const marks: { from: number; to: number; cls: string }[] = [];

  let line = 0;
  let char = 0;

  for (const token of tokens) {
    line += token.deltaLine;
    if (token.deltaLine > 0) {
      char = token.deltaStart;
    } else {
      char += token.deltaStart;
    }

    const cls = TOKEN_CLASSES[token.tokenType];
    if (!cls) continue;

    // LSP lines are 0-indexed, CodeMirror lines are 1-indexed
    const lineInfo = doc.line(line + 1);
    const from = lineInfo.from + char;
    const to = from + token.length;

    // Add defaultLibrary modifier class
    const fullCls =
      token.tokenModifiersBitset & 1
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

// ─── View plugin that listens for pushed tokens from the worker ────────────

function semanticHighlightPlugin(worker: Worker) {
  return ViewPlugin.fromClass(
    class {
      private handler: (event: MessageEvent) => void;

      constructor(private view: EditorView) {
        this.handler = (event: MessageEvent) => {
          const msg = event.data;
          if (msg?.method !== "celsp/semanticTokens") return;

          const result = msg.params?.tokens;
          if (!result?.data || !Array.isArray(result.data)) return;

          const tokens = decodeTokenData(result.data as number[]);
          const decorations = buildDecorations(tokens, this.view.state.doc);
          this.view.dispatch({ effects: setTokens.of(decorations) });
        };
        worker.addEventListener("message", this.handler);
      }

      update(_update: ViewUpdate) {
        // No need to request tokens — the worker pushes them after
        // every didOpen/didChange notification from the LSP client.
      }

      destroy() {
        worker.removeEventListener("message", this.handler);
      }
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
 * Listens for worker-pushed `celsp/semanticTokens` notifications.
 */
export function celSemanticHighlighting(worker: Worker) {
  return [tokenDecorations, semanticHighlightPlugin(worker), semanticTheme];
}
