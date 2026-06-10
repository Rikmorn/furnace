import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type RunningServer, startServer } from "../src/daemon/server.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "mini-project");
let server: RunningServer;

beforeAll(async () => {
  server = await startServer({ root: FIXTURE, port: 0 }); // port 0 = OS-assigned
});
afterAll(() => server.close());

const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;

test("GET / serves the placeholder page", async () => {
  const res = await fetch(url("/"));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("furnace editor");
});

test("POST /api/scene.list returns the fixture's scenes", async () => {
  const res = await fetch(url("/api/scene.list"), {
    method: "POST",
    body: "{}",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ scenes: ["scenes/cube.scene.json"] });
});

test("POST /api/scene.read returns the parsed document", async () => {
  const res = await fetch(url("/api/scene.read"), {
    method: "POST",
    body: JSON.stringify({ path: "scenes/cube.scene.json" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { document: { version: number } };
  expect(body.document.version).toBe(1);
});

test("unknown command → 404 JSON error", async () => {
  const res = await fetch(url("/api/scene.zap"), {
    method: "POST",
    body: "{}",
  });
  expect(res.status).toBe(404);
  expect(((await res.json()) as { error: string }).error).toContain(
    "scene.zap",
  );
});

test("bad input → 400 JSON error", async () => {
  const res = await fetch(url("/api/scene.read"), {
    method: "POST",
    body: JSON.stringify({ path: 7 }),
  });
  expect(res.status).toBe(400);
});

test("GET /engine.js serves the ESM bundle", async () => {
  const res = await fetch(url("/engine.js"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/javascript");
  expect(await res.text()).toContain("createViewportHost");
});

test("GET /engine.js with a broken extensions entry → 500 with diagnostics", async () => {
  // The broken project must live INSIDE the workspace so esbuild resolves
  // @furnace/editor/viewport-host (self-reference up to packages/editor's
  // package.json) and then reaches the genuinely-missing extension import. A
  // root outside the workspace (e.g. os.tmpdir()) fails on the unresolvable
  // viewport-host FIRST — that is the documented project-first behavior (see
  // bundle.test.ts), not what this test is asserting. We assert the *extension*
  // diagnostic surfaces, so we keep the broken root in-workspace.
  // mkdtempSync first (nothing to clean if it itself throws); everything that
  // writes into the tree or starts a server goes inside the try, so the finally
  // rmSync always removes the in-tree broken-* dir even on a setup failure.
  const brokenRoot = mkdtempSync(join(import.meta.dir, "fixtures", "broken-"));
  let broken: RunningServer | undefined;
  try {
    mkdirSync(join(brokenRoot, "src"), { recursive: true });
    writeFileSync(
      join(brokenRoot, "furnace.config.json"),
      JSON.stringify({ extensions: "src/broken.ts" }),
    );
    writeFileSync(
      join(brokenRoot, "src", "broken.ts"),
      'import { nope } from "./missing.ts";',
    );
    broken = await startServer({ root: brokenRoot, port: 0 });
    const res = await fetch(`http://127.0.0.1:${broken.port}/engine.js`);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("missing");
  } finally {
    broken?.close();
    rmSync(brokenRoot, { recursive: true, force: true });
  }
});
