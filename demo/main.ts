import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { cel } from "../src/index.ts";

const SAMPLE_CEL = `"hello world".startsWith("hello") && "test".size() > 2`;

const status = document.getElementById("status")!;

async function main() {
  try {
    const worker = new Worker("/worker.js", { type: "module" });
    const celExtensions = await cel({ worker });

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
