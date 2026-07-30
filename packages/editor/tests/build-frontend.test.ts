import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PKG = join(import.meta.dir, "..");
const DIST = join(PKG, "dist", "frontend");

// Internal tooling test — Bun APIs allowed (only daemon/viewport-host src is Node-portable).
test("build-frontend produces index.html + bundled assets", async () => {
  rmSync(DIST, { recursive: true, force: true });
  const proc = Bun.spawn(["bun", join(PKG, "scripts", "build-frontend.ts")], {
    cwd: PKG,
  });
  expect(await proc.exited).toBe(0);
  expect(existsSync(join(DIST, "index.html"))).toBe(true);
  // The two by-URL workers each ship as their own module bundle so the chrome can
  // spawn them by URL (new Worker("/field-worker.js", {type: "module"})):
  // /field-worker.js (the field remesher) and /analyzer-worker.js (the walkability
  // advisor, F4). Each must land un-hashed at the outdir root or that URL 404s.
  expect(existsSync(join(DIST, "field-worker.js"))).toBe(true);
  expect(existsSync(join(DIST, "analyzer-worker.js"))).toBe(true);
}, 60_000);
