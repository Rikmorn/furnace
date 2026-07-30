import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RunningServer, startServer } from "../src/daemon/server.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "mini-project");
let server: RunningServer;

function staticFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "furnace-static-"));
  writeFileSync(
    join(dir, "index.html"),
    "<!doctype html><title>chrome-fixture</title>",
  );
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  return dir;
}

beforeAll(async () => {
  server = await startServer({
    root: FIXTURE,
    port: 0,
    staticDir: staticFixture(),
  });
});
afterAll(() => server.close());

const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;

test("GET / serves the built chrome's index.html", async () => {
  const res = await fetch(url("/"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("chrome-fixture");
});

test("GET /assets/app.js serves with a JS content-type", async () => {
  const res = await fetch(url("/assets/app.js"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/javascript");
});

test("static paths cannot escape the static dir", async () => {
  // The URL constructor normalizes `..` segments away before the server sees
  // the path, so raw traversal never reaches serveStatic; its startsWith guard
  // is defence-in-depth. This asserts the end-to-end guarantee holds.
  const res = await fetch(url("/../package.json"));
  expect(res.status).toBe(404);
});

test("missing static dir → 503 with a build hint", async () => {
  const bare = await startServer({
    root: FIXTURE,
    port: 0,
    staticDir: join(tmpdir(), `nope-${Date.now()}`),
  });
  const res = await fetch(`http://127.0.0.1:${bare.port}/`);
  expect(res.status).toBe(503);
  expect(await res.text()).toContain("build:frontend");
  bare.close();
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
  const body = (await res.json()) as {
    error: { code: string; message: string };
  };
  expect(body.error.code).toBe("unknown-command");
  expect(body.error.message).toContain("scene.zap");
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
  expect(await res.text()).toContain("createFieldHost");
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
      JSON.stringify({ editor: { extensions: "src/broken.ts" } }),
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

type SseReader = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
};

function openSseReader(res: Response): SseReader {
  if (!res.body) throw new Error("SSE response has no body");
  return {
    reader: res.body.getReader(),
    decoder: new TextDecoder(),
    buffer: "",
  };
}

async function readSse(
  state: SseReader,
  predicate: (buffer: string) => boolean,
  timeoutMs = 8000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await state.reader.read();
    if (done) break;
    state.buffer += state.decoder.decode(value, { stream: true });
    if (predicate(state.buffer)) return state.buffer;
  }
  throw new Error(`SSE timeout; buffer so far:\n${state.buffer}`);
}

test("structured error bodies carry code + message", async () => {
  const res = await fetch(url("/api/scene.read"), {
    method: "POST",
    body: JSON.stringify({ path: "ghost.scene.json" }),
  });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    error: {
      code: "not-found",
      message: 'scene file "ghost.scene.json" not found',
    },
  });
});

test("session lifecycle over HTTP with a live SSE feed + watcher reload", async () => {
  // Dedicated server over an in-workspace COPY of mini-project: this test
  // mutates scene files (save + on-disk edit), so it must not touch FIXTURE.
  const root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-sse-"));
  let live: RunningServer | undefined;
  try {
    cpSync(FIXTURE, root, { recursive: true });
    live = await startServer({ root, port: 0, staticDir: staticFixture() });
    const port = live.port;
    const liveUrl = (p: string) => `http://127.0.0.1:${port}${p}`;
    const sseRes = await fetch(liveUrl("/api/events"));
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream");
    const sseState = openSseReader(sseRes);

    const post = (cmd: string, body: unknown) =>
      fetch(liveUrl(`/api/${cmd}`), {
        method: "POST",
        body: JSON.stringify(body),
      });

    const opened = await post("scene.open", { path: "scenes/cube.scene.json" });
    expect(opened.status).toBe(200);
    await readSse(sseState, (b) => b.includes("event: scene-opened"));

    const added = await post("scene.addEntity", {});
    expect(((await added.json()) as { id: string }).id).toBe("entity-1");
    await readSse(
      sseState,
      (b) =>
        b.includes("event: document-changed") && b.includes("scene.addEntity"),
    );

    // Disk edit on the CLEAN session → watcher reload event.
    await post("scene.undo", {}); // back to clean
    writeFileSync(
      join(root, "scenes", "cube.scene.json"),
      JSON.stringify({ version: 1, entities: [] }),
    );
    await readSse(sseState, (b) => b.includes("file-reload"));

    const view = (await (await post("scene.get", {})).json()) as {
      document: { entities: unknown[] };
      dirty: boolean;
    };
    expect(view.document.entities).toHaveLength(0);
    expect(view.dirty).toBe(false);
  } finally {
    live?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
