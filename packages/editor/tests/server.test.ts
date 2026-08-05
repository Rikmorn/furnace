import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

test("POST /api/project.get returns the served root", async () => {
  const res = await fetch(url("/api/project.get"), {
    method: "POST",
    body: "{}",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ root: FIXTURE });
});

test("POST /api/world.list returns the fixture's (empty) worlds index", async () => {
  const res = await fetch(url("/api/world.list"), {
    method: "POST",
    body: "{}",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ defaultName: null, worlds: [] });
});

test("unknown command → 404 JSON error", async () => {
  const res = await fetch(url("/api/nope.zap"), {
    method: "POST",
    body: "{}",
  });
  expect(res.status).toBe(404);
  const body = (await res.json()) as {
    error: { code: string; message: string };
  };
  expect(body.error.code).toBe("unknown-command");
  expect(body.error.message).toContain("nope.zap");
});

test("bad input → 400 JSON error", async () => {
  const res = await fetch(url("/api/field.load"), {
    method: "POST",
    body: JSON.stringify({ name: 7 }),
  });
  expect(res.status).toBe(400);
});

test("a body that is not JSON → 400 invalid-json", async () => {
  const res = await fetch(url("/api/project.get"), {
    method: "POST",
    body: "{ not json",
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("invalid-json");
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
  const res = await fetch(url("/api/field.load"), {
    method: "POST",
    body: JSON.stringify({ name: "ghost" }),
  });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    error: { code: "not-found", message: 'world "ghost" has no manifest' },
  });
});

test("a command's emission reaches a live SSE subscriber over HTTP", async () => {
  // Dedicated server over an in-workspace COPY of mini-project: this test WRITES
  // into the project root (generation.bake), so it must not touch FIXTURE.
  //
  // The event asserted here is same-process: the handler emits synchronously inside
  // the request it serves, so the frame is already queued when the POST resolves.
  // (The scene-era version of this test also waited on a chokidar FILE event, which
  // could be missed outright. That half went with the watcher; nothing in the surviving
  // feed races.)
  const root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-sse-"));
  let live: RunningServer | undefined;
  try {
    cpSync(FIXTURE, root, { recursive: true });
    live = await startServer({ root, port: 0, staticDir: staticFixture() });
    const port = live.port;
    const sseRes = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream");
    const sseState = openSseReader(sseRes);

    const baked = await fetch(`http://127.0.0.1:${port}/api/generation.bake`, {
      method: "POST",
      body: JSON.stringify({
        files: [
          { path: "worlds/w/manifest.json", encoding: "utf8", contents: "{}" },
        ],
      }),
    });
    expect(await baked.json()).toEqual({ files: 1 });
    expect(existsSync(join(root, "worlds", "w", "manifest.json"))).toBe(true);

    const buffer = await readSse(sseState, (b) =>
      b.includes("event: generation-baked"),
    );
    expect(buffer).toContain('data: {"type":"generation-baked","files":1}');
  } finally {
    live?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
