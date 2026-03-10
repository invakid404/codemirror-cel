/**
 * Semantic token highlighting for CEL.
 *
 * Listens for `celsp/semanticTokens` notifications pushed by the worker
 * (sent proactively after didOpen/didChange) and applies CodeMirror
 * Decorations — bypassing the LSP client which doesn't support semantic tokens.
 *
 * Integrates with CM6's tag-based highlighting system via `highlightingFor()`,
 * so tokens are styled by whatever `HighlightStyle` the consumer has active
 * (e.g. oneDark, defaultHighlightStyle, or a custom theme).
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { RangeSetBuilder } from "@codemirror/state";
import { tags, type Tag } from "@lezer/highlight";
import { highlightingFor } from "@codemirror/language";

// ─── LSP token type → lezer Tag mapping ────────────────────────────────────

/**
 * Maps LSP semantic token type indices to lezer Tag arrays.
 * Indices match the legend order in `semantic_tokens.rs`:
 *   0=keyword, 1=number, 2=string, 3=operator,
 *   4=variable, 5=function, 6=method, 7=punctuation
 */
const TOKEN_TAGS: readonly (readonly Tag[])[] = [
  [tags.keyword],                     // 0: keyword (true, false, null)
  [tags.number],                      // 1: number
  [tags.string],                      // 2: string
  [tags.operator],                    // 3: operator
  [tags.variableName],                // 4: variable
  [tags.function(tags.variableName)], // 5: function
  [tags.function(tags.propertyName)], // 6: method
  [tags.punctuation],                 // 7: punctuation
];

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
  state: EditorState,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const marks: { from: number; to: number; cls: string }[] = [];
  const decoCache = new Map<string, Decoration>();

  let line = 0;
  let char = 0;

  for (const token of tokens) {
    line += token.deltaLine;
    if (token.deltaLine > 0) {
      char = token.deltaStart;
    } else {
      char += token.deltaStart;
    }

    let tagList = TOKEN_TAGS[token.tokenType];
    if (!tagList) continue;

    // Apply the standard() modifier for defaultLibrary tokens
    if (token.tokenModifiersBitset & 1) {
      tagList = tagList.map((t) => tags.standard(t));
    }

    // Query the active theme's highlighters for the CSS class
    const cls = highlightingFor(state, tagList);
    if (!cls) continue;

    // LSP lines are 0-indexed, CodeMirror lines are 1-indexed
    const lineInfo = doc.line(line + 1);
    const from = lineInfo.from + char;
    const to = from + token.length;

    marks.push({ from, to, cls });
  }

  // RangeSetBuilder requires sorted ranges
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const { from, to, cls } of marks) {
    let deco = decoCache.get(cls);
    if (!deco) {
      deco = Decoration.mark({ class: cls });
      decoCache.set(cls, deco);
    }
    builder.add(from, to, deco);
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
          const decorations = buildDecorations(
            tokens,
            this.view.state.doc,
            this.view.state,
          );
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

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Create a CodeMirror extension for CEL semantic token highlighting.
 *
 * Listens for worker-pushed `celsp/semanticTokens` notifications and applies
 * decorations using classes from the active `HighlightStyle`. The consumer
 * must have a `syntaxHighlighting(...)` extension installed (e.g. `oneDark`,
 * `defaultHighlightStyle`) for tokens to be styled.
 */
export function celSemanticHighlighting(worker: Worker) {
  return [tokenDecorations, semanticHighlightPlugin(worker)];
}
