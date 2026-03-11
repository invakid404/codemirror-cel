import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { cel } from "../src/index.ts";
import type { VariableDeclaration, FunctionDeclaration } from "../src/types.ts";

// ─── Environment: variables available in CEL expressions ────────────────────

const variables: VariableDeclaration[] = [
  { name: "user", type: { kind: "map", keyType: "string", valueType: "dyn" } },
  { name: "request", type: { kind: "map", keyType: "string", valueType: "dyn" } },
  { name: "now", type: "timestamp" },
  { name: "labels", type: { kind: "list", elementType: "string" } },
  { name: "threshold", type: "double" },
];

// ─── Environment: custom function declarations ──────────────────────────────

const functions: FunctionDeclaration[] = [
  {
    name: "isEmail",
    params: [{ name: "value", type: "string" }],
    returnType: "bool",
  },
  {
    name: "clamp",
    params: [
      { name: "value", type: "double" },
      { name: "min", type: "double" },
      { name: "max", type: "double" },
    ],
    returnType: "double",
  },
  {
    name: "slugify",
    params: [{ name: "text", type: "string" }],
    returnType: "string",
  },
];

// ─── Sample expression that uses the custom environment ─────────────────────

const SAMPLE_CEL = `user.email.endsWith("@acme.com")
  && isEmail(user.email)
  && clamp(request.score, 0.0, threshold) > 0.5
  && labels.exists(l, l.startsWith("prod"))`;

// ─── Editor setup ───────────────────────────────────────────────────────────

const status = document.getElementById("status")!;

async function main() {
  try {
    const worker = new Worker("./worker.js", { type: "module" });
    const celExtensions = await cel({
      worker,
      variables,
      functions,
    });

    status.textContent = "Ready";

    new EditorView({
      parent: document.getElementById("editor-container")!,
      state: EditorState.create({
        doc: SAMPLE_CEL,
        extensions: [
          basicSetup,
          ...celExtensions,
          oneDark,
        ],
      }),
    });
  } catch (err) {
    status.textContent = `Error: ${err}`;
    console.error(err);
  }
}

main();
