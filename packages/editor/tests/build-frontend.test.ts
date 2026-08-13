import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PKG = join(import.meta.dir, "..");

// Internal tooling test — Bun APIs allowed (only daemon/field-host src is Node-portable).
//
// BUILDS INTO A TEMP OUTDIR, not the real `dist/frontend`. This test used to `rmSync` that
// directory and rebuild it, and the directory is the daemon's DEFAULT_STATIC_DIR — so under
// a parallel runner `project-assets.test.ts` could read it inside the delete window and get
// `serveStatic`'s 503 ("editor chrome not built") where it asserted 404. Reproduced
// deterministically by moving `dist/frontend` aside and running that file alone. Building
// elsewhere also stops `bun test` from wiping a developer's built chrome as a side effect.
test("build-frontend produces index.html + bundled assets", async () => {
  const DIST = mkdtempSync(join(tmpdir(), "furnace-frontend-build-"));
  try {
    const proc = Bun.spawn(["bun", join(PKG, "scripts", "build-frontend.ts")], {
      cwd: PKG,
      env: { ...process.env, FURNACE_FRONTEND_OUTDIR: DIST },
    });
    expect(await proc.exited).toBe(0);
    expect(existsSync(join(DIST, "index.html"))).toBe(true);
    // The two by-URL workers each ship as their own module bundle so the chrome can
    // spawn them by URL (new Worker("/field-worker.js", {type: "module"})):
    // /field-worker.js (the field remesher) and /analyzer-worker.js (the walkability
    // advisor, F4). Each must land un-hashed at the outdir root or that URL 404s.
    expect(existsSync(join(DIST, "field-worker.js"))).toBe(true);
    expect(existsSync(join(DIST, "analyzer-worker.js"))).toBe(true);
  } finally {
    rmSync(DIST, { recursive: true, force: true });
  }
}, 60_000);
