import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cel } from "../src/index.ts";

const SAMPLE_CEL = `// Try typing a dot after "name" or pressing Ctrl+Space
user.name.startsWith("admin") && age >= 21
`;

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
          EditorView.theme({
            "&": { backgroundColor: "#1a1a1a" },
            ".cm-content": { caretColor: "#fff" },
            ".cm-gutters": {
              backgroundColor: "#1a1a1a",
              borderRight: "1px solid #333",
            },
          }),
        ],
      }),
    });
  } catch (err) {
    status.textContent = `Error: ${err}`;
    console.error(err);
  }
}

main();
