import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/daemon/server.ts";

// Projects reference asset sidecars by root-absolute URL (e.g. the dungeon's entity-catalog
// meshes: `"catalog/meshes/rock.0.fmesh"`, fetched as `/catalog/...`), resolved same-origin
// by the browser-side loader. The consumer's own dev server maps those paths onto the project
// tree — the daemon must mirror that layout for GET misses of the chrome, or every sidecar
// fetch 404s in the editor (found live at the 3.0 gate, on a since-retired `.fmesh` fixture).
// The temp dir below is a stand-in for any such asset dir; the mapping under test is
// name-agnostic.
describe("project asset serving", () => {
  /** A chrome dir that EXISTS but holds none of the paths asked for below, so a miss reaches
   *  the 404 these cases are about. Without it `startServer` falls back to DEFAULT_STATIC_DIR
   *  — the real `packages/editor/dist/frontend` — and every assertion here silently depends on
   *  a build artifact: `serveStatic` answers 503 ("editor chrome not built"), not 404, when
   *  that directory is absent. It read as a rare parallel flake because the only thing that
   *  removed the directory was `build-frontend.test.ts` rebuilding it; on a fresh clone that
   *  has never built the chrome it is not a flake at all. Same shape as `server.test.ts`'s
   *  `staticFixture()`. */
  const chromeFixture = (): string =>
    mkdtempSync(join(tmpdir(), "furnace-assets-chrome-"));

  const setup = () => {
    const root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-assets-"));
    mkdirSync(join(root, "regions"), { recursive: true });
    writeFileSync(join(root, "regions", "r.fmesh"), Buffer.from("FMSHtest"));
    writeFileSync(join(root, ".env"), "SECRET=1\n");
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "x");
    return root;
  };

  test("a root-absolute sidecar path serves the project file with octet-stream", async () => {
    const root = setup();
    try {
      const server = await startServer({
        root,
        port: 0,
        staticDir: chromeFixture(),
      });
      try {
        const res = await fetch(
          `http://127.0.0.1:${server.port}/regions/r.fmesh`,
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe(
          "application/octet-stream",
        );
        expect(await res.text()).toBe("FMSHtest");
      } finally {
        server.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dotfile segments and node_modules are refused; traversal stays root-contained", async () => {
    const root = setup();
    try {
      const server = await startServer({
        root,
        port: 0,
        staticDir: chromeFixture(),
      });
      try {
        const base = `http://127.0.0.1:${server.port}`;
        expect((await fetch(`${base}/.env`)).status).toBe(404);
        expect((await fetch(`${base}/node_modules/pkg/index.js`)).status).toBe(
          404,
        );
        // Encoded traversal out of the project root must not escape.
        expect(
          (await fetch(`${base}/regions/%2e%2e/%2e%2e/etc/passwd`)).status,
        ).toBe(404);
      } finally {
        server.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
