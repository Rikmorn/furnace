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
  // The generation worker (Slice 3.2.3) ships as its own module bundle so the
  // chrome can spawn it by URL: new Worker("/generation-worker.js", {type:
  // "module"}). It must land un-hashed at the outdir root or that URL 404s.
  expect(existsSync(join(DIST, "generation-worker.js"))).toBe(true);
  // Same contract for the other two by-URL workers: /field-worker.js (the field
  // remesher) and /analyzer-worker.js (the walkability advisor, F4).
  expect(existsSync(join(DIST, "field-worker.js"))).toBe(true);
  expect(existsSync(join(DIST, "analyzer-worker.js"))).toBe(true);
}, 60_000);
