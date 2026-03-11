import { rmSync, cpSync } from "node:fs";

// Clean
rmSync("dist", { recursive: true, force: true });

// Library: JS bundle with all packages externalized
const lib = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  format: "esm",
  target: "browser",
  splitting: true,
  packages: "external",
});

if (!lib.success) {
  console.error("Library build failed:");
  for (const log of lib.logs) console.error(log);
  process.exit(1);
}

// Worker: fully bundled (inlines WASM glue so consumers just load it as
// a Worker). The .wasm binary is fetched at runtime via the glue's init().
const worker = await Bun.build({
  entrypoints: ["src/worker.ts"],
  outdir: "dist",
  format: "esm",
  target: "browser",
  naming: "worker.js",
});

if (!worker.success) {
  console.error("Worker build failed:");
  for (const log of worker.logs) console.error(log);
  process.exit(1);
}

// Declarations: Bun can't emit .d.ts, so we use tsc for this only
const tsc = Bun.spawnSync(["bun", "tsc", "-p", "tsconfig.build.json"]);
if (tsc.exitCode !== 0) {
  console.error("Declaration emit failed:");
  console.error(tsc.stderr.toString());
  process.exit(1);
}

// Copy WASM binary — the bundled worker fetches this at runtime
// relative to import.meta.url
cpSync("crates/celsp/pkg/celsp_bg.wasm", "dist/celsp_bg.wasm");

console.log("Build complete.");
