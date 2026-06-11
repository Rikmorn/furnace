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
}, 60_000);
