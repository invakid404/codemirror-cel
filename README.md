# codemirror-cel

A [CodeMirror 6](https://codemirror.net/) extension that adds full language support for
[CEL (Common Expression Language)](https://github.com/google/cel-spec) — powered by a
WASM language server running in a Web Worker.

**[Live demo](https://invakid404.github.io/codemirror-cel)**

## Features

- **Diagnostics** — real-time error checking as you type
- **Autocompletion** — variables, functions, methods, and field access
- **Hover** — type information on hover
- **Semantic highlighting** — full token-level highlighting that integrates with your CodeMirror theme

All of this runs entirely in the browser — no server required.

## Quick start

```bash
npm install codemirror-cel
```

```ts
import { cel } from "codemirror-cel";
import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const worker = new Worker(
  new URL("codemirror-cel/worker", import.meta.url),
  { type: "module" },
);

const celExtensions = await cel({
  worker,
  variables: [
    { name: "user", type: { kind: "map", keyType: "string", valueType: "dyn" } },
    { name: "now", type: "timestamp" },
  ],
  functions: [
    {
      name: "isEmail",
      params: [{ name: "value", type: "string" }],
      returnType: "bool",
    },
  ],
});

new EditorView({
  parent: document.getElementById("editor")!,
  state: EditorState.create({
    doc: 'user.email.endsWith("@acme.com") && isEmail(user.email)',
    extensions: [basicSetup, ...celExtensions],
  }),
});
```

## Configuration

The `cel()` function accepts a `CelConfig` object:

| Option | Type | Default | Description |
|---|---|---|---|
| `worker` | `Worker` | **(required)** | A Web Worker running the celsp WASM language server. |
| `variables` | `VariableDeclaration[]` | `[]` | Variables available in the CEL environment. |
| `functions` | `FunctionDeclaration[]` | `[]` | Custom function declarations for the type-checker. |
| `rootUri` | `string` | `"file:///"` | LSP workspace root URI. |
| `documentUri` | `string` | `"file:///cel.cel"` | URI for the document being edited. |
| `languageId` | `string` | `"cel"` | Language ID sent to the LSP server. |
| `hoverShowErrors` | `boolean` | `false` | Include check-error details in hover tooltips. |

### Types

Variables use CEL's type system:

```ts
// Primitive types
{ name: "active", type: "bool" }
{ name: "count", type: "int" }
{ name: "score", type: "double" }
{ name: "name", type: "string" }
{ name: "now", type: "timestamp" }
{ name: "ttl", type: "duration" }

// List type
{ name: "tags", type: { kind: "list", elementType: "string" } }

// Map type
{ name: "headers", type: { kind: "map", keyType: "string", valueType: "string" } }

// Nested types
{ name: "matrix", type: { kind: "list", elementType: { kind: "list", elementType: "int" } } }
```

Functions declare parameter names, types, and a return type:

```ts
{
  name: "clamp",
  params: [
    { name: "value", type: "double" },
    { name: "min", type: "double" },
    { name: "max", type: "double" },
  ],
  returnType: "double",
}
```

## How it works

The extension runs a [fork](https://github.com/invakid404/celsp) of
[celsp](https://github.com/ponix-dev/celsp) by [ponix-dev](https://github.com/ponix-dev)
— a CEL language server written in Rust — compiled to WebAssembly inside a Web Worker.
LSP messages are bridged between the worker and CodeMirror via `postMessage`.

Semantic highlighting is handled through a custom side-channel (since the upstream
CodeMirror LSP plugin doesn't support semantic tokens) and integrates with whatever
`HighlightStyle` you have active (e.g. `oneDark`).

## License

[Unlicense](LICENSE) — public domain.
