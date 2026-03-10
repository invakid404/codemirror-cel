import index from "./index.html";

Bun.serve({
  port: 3000,
  routes: {
    "/": index,
    // Serve the WASM binary at the path the demo expects
    "/wasm/celsp_wasm_bg.wasm": async () => {
      const file = Bun.file(
        new URL(
          "../crates/celsp-wasm/pkg/celsp_wasm_bg.wasm",
          import.meta.url,
        ),
      );
      return new Response(file, {
        headers: { "Content-Type": "application/wasm" },
      });
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log("Demo running at http://localhost:3000");
