import { test, expect } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";

let server: ChildProcess;

test.beforeAll(async () => {
  try {
    const proc = spawn("lsof", ["-ti:3000"]);
    const pid = await new Promise<string>((resolve) => {
      let out = "";
      proc.stdout?.on("data", (d) => (out += d));
      proc.on("close", () => resolve(out.trim()));
    });
    if (pid) process.kill(Number(pid), 9);
  } catch {}

  await new Promise((r) => setTimeout(r, 500));

  server = spawn("bun", ["run", "demo"], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    detached: true,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Server start timeout")),
      15000,
    );
    server.stdout?.on("data", (data) => {
      if (data.toString().includes("Demo running")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr?.on("data", (data) => {
      console.error("Server stderr:", data.toString());
    });
  });
});

test.afterAll(async () => {
  if (server?.pid) {
    // Kill the entire process group so child processes (bun serve) also die
    try {
      process.kill(-server.pid, 9);
    } catch {
      server.kill(9);
    }
  }
});

test("semantic highlighting applies styled spans", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForSelector("#status:has-text('Ready')", { timeout: 10000 });
  // Wait for semantic tokens to arrive from worker
  await page.waitForTimeout(2000);

  // Check that styled spans exist in the editor content.
  // With highlightingFor() + a HighlightStyle (oneDark), the class names
  // are auto-generated (e.g. "ͼ1a"). We verify that spans have classes
  // and that at least some have distinct computed colors (not all the same).
  const colorInfo = await page.evaluate(() => {
    const editor = document.querySelector(".cm-content");
    if (!editor) return { spanCount: 0, uniqueColors: 0 };
    const spans = Array.from(editor.querySelectorAll("span[class]"));
    const colors = new Set<string>();
    for (const span of spans) {
      const style = window.getComputedStyle(span);
      colors.add(style.color);
    }
    return { spanCount: spans.length, uniqueColors: colors.size };
  });

  console.log(
    `Spans: ${colorInfo.spanCount}, unique colors: ${colorInfo.uniqueColors}`,
  );
  await page.screenshot({ path: "test/screenshots/01-highlighting.png" });

  // The demo expression has strings, operators, methods, booleans — expect
  // multiple styled spans with more than one distinct color.
  expect(colorInfo.spanCount).toBeGreaterThan(0);
  expect(colorInfo.uniqueColors).toBeGreaterThan(1);
});

test("typing 'al' should keep 'all' in completions", async ({ page }) => {
  // Collect console logs from the page
  const logs: string[] = [];
  page.on("console", (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto("http://localhost:3000");
  await page.waitForSelector(".cm-editor", { timeout: 10000 });
  await page.waitForSelector("#status:has-text('Ready')", { timeout: 10000 });
  await page.waitForTimeout(1000);

  const editor = page.locator(".cm-content");

  // Clear editor
  await editor.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(500);

  // Type 'a'
  await page.keyboard.type("a", { delay: 50 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: "test/screenshots/02-typed-a.png" });
  const afterA = await page
    .locator(".cm-tooltip-autocomplete li")
    .allTextContents();
  console.log("Completions after 'a':", afterA);

  // Type 'l' (now 'al')
  await page.keyboard.type("l", { delay: 50 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: "test/screenshots/03-typed-al.png" });
  const afterAL = await page
    .locator(".cm-tooltip-autocomplete li")
    .allTextContents();
  console.log("Completions after 'al':", afterAL);

  // Dump any relevant console output
  const relevant = logs.filter(
    (l) =>
      l.includes("completion") ||
      l.includes("Completion") ||
      l.includes("error") ||
      l.includes("Error"),
  );
  if (relevant.length) console.log("Relevant logs:", relevant);

  // Check: 'all' should be present after typing 'al'
  const hasAll = afterAL.some((t) => t.includes("all"));

  if (!hasAll) {
    // Get more details about what CM is showing
    const tooltipHTML = await page
      .locator(".cm-tooltip-autocomplete")
      .innerHTML()
      .catch(() => "no tooltip");
    console.log("Tooltip HTML:", tooltipHTML);
  }

  expect(hasAll).toBe(true);
});
