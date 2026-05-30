/**
 * Render a GLB exported by this server into a still PNG, for README heroes
 * and docs. Spins up a tiny static server (so three.js ESM + the GLB load
 * over http), drives a headless Chromium via Playwright to render the scene
 * in `scripts/render/viewer.html`, and screenshots the result.
 *
 *   npm run render:glb -- --glb out/scene_xxx.glb --out docs/assets/hero.png
 *
 * Options:
 *   --glb <path>     GLB to render                       (required)
 *   --out <path>     output PNG path                      (required)
 *   --style <name>   "tech" (dark) | "day" (light)        (default tech)
 *   --width <px>     viewport width                       (default 1600)
 *   --height <px>    viewport height                      (default 760)
 *   --fit <n>        framing; <1 zooms in, >1 zooms out   (default 0.56)
 *   --azim <deg>     camera azimuth                        (default 45)
 *   --elev <deg>     camera elevation                      (default 33)
 *
 * Requires the `playwright` devDependency and its Chromium:
 *   npm install && npx playwright install chromium
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const THREE_DIR = resolve(REPO_ROOT, "node_modules/three");
const VIEWER = resolve(HERE, "render/viewer.html");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const glbPath = arg("glb");
const outPath = arg("out");
if (!glbPath || !outPath) {
  console.error(
    "usage: npm run render:glb -- --glb <in.glb> --out <out.png> [--style tech|day] [--width 1600] [--height 760] [--fit 0.56] [--azim 45] [--elev 33]",
  );
  process.exit(1);
}
const style = arg("style", "tech")!;
const width = Number(arg("width", "1600"));
const height = Number(arg("height", "760"));
const fit = arg("fit", "0.56")!;
const azim = arg("azim", "45")!;
const elev = arg("elev", "33")!;

const CONTENT_TYPE: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
};

// Tiny static server: only exposes the viewer, three.js, and the chosen GLB.
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file: string | null = null;
    if (url.pathname === "/viewer.html") file = VIEWER;
    else if (url.pathname === "/model.glb") file = resolve(process.cwd(), glbPath);
    else if (url.pathname.startsWith("/three/")) {
      const rel = url.pathname.slice("/three/".length);
      const target = resolve(THREE_DIR, rel);
      if (target.startsWith(THREE_DIR)) file = target; // path-traversal guard
    }
    if (!file) {
      res.writeHead(404).end("not found");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": CONTENT_TYPE[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(500).end("error");
  }
});

await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address() as { port: number };
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.error("[page]", e.message));
  const q = new URLSearchParams({
    glb: "/model.glb",
    w: String(width),
    h: String(height),
    style,
    fit,
    azim,
    elev,
  });
  await page.goto(`${base}/viewer.html?${q}`, { waitUntil: "networkidle" });
  const status = await page
    .waitForFunction(() => (window as unknown as { __rendered?: unknown }).__rendered ?? false, {
      timeout: 60_000,
    })
    .then((h) => h.jsonValue());
  if (status === "error") throw new Error("viewer failed to load the GLB");
  await page.waitForTimeout(300);
  const out = resolve(process.cwd(), outPath);
  await page.screenshot({ path: out });
  console.log(`wrote ${out} (${width}x${height} @2x, style=${style})`);
} finally {
  await browser.close();
  server.close();
}
