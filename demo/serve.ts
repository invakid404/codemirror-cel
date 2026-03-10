import index from "./index.html";

const wasmPath = new URL(
  "../crates/celsp-wasm/pkg/celsp_wasm_bg.wasm",
  import.meta.url,
).pathname;

// Pre-bundle the worker so it can be served as a single JS file.
const workerBuild = await Bun.build({
  entrypoints: [new URL("../src/worker.ts", import.meta.url).pathname],
  format: "esm",
  target: "browser",
});
const workerCode = await workerBuild.outputs[0]!.text();

Bun.serve({
  port: 3000,
  routes: {
    "/": index,
    "/worker.js": () =>
      new Response(workerCode, {
        headers: { "Content-Type": "application/javascript" },
      }),
    "/wasm/celsp_wasm_bg.wasm": () =>
      new Response(Bun.file(wasmPath), {
        headers: { "Content-Type": "application/wasm" },
      }),
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log("Demo running at http://localhost:3000");
