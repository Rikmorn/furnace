import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../src/daemon/server.ts";

// Scene documents reference asset sidecars by root-absolute URL (e.g. the dungeon's
// region docs: `"src": "/regions/region-cavern.fmesh"`), resolved same-origin by the
// browser-side loader. The consumer's own dev server maps those paths onto the project
// tree — the daemon must mirror that layout for GET misses of the chrome, or every
// sidecar fetch 404s in the editor (found live at the 3.0 gate on region-cavern).
describe("project asset serving", () => {
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
      const server = await startServer({ root, port: 0 });
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
      const server = await startServer({ root, port: 0 });
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
