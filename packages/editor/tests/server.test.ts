import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
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

/** Send a request line + headers over a raw socket and return the whole response text.
 *  `fetch` cannot express what these tests need: it normalizes a request target like
 *  `//` away before the wire, and it refuses to set `Origin` on some shapes. The socket
 *  sends exactly the bytes given. */
function rawRequest(
  requestLine: string,
  ...headers: string[]
): Promise<string> {
  return new Promise((done, fail) => {
    const socket = connect(server.port, "127.0.0.1", () => {
      socket.write(
        `${[requestLine, "Host: 127.0.0.1", ...headers, "Connection: close"].join("\r\n")}\r\n\r\n`,
      );
    });
    let text = "";
    socket.setTimeout(5000, () => {
      socket.destroy();
      fail(new Error(`no response to ${requestLine} within 5s`));
    });
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    socket.on("close", () => done(text));
    socket.on("error", fail);
  });
}

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
  // @furnace/editor/field-host (self-reference up to packages/editor's
  // package.json) and then reaches the genuinely-missing extension import. A
  // root outside the workspace (e.g. os.tmpdir()) fails on the unresolvable
  // field-host FIRST — that is the documented project-first behavior (see
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

// --- Origin: the DNS-rebinding refusal, WIRED (foundations T4a) --------------
//
// WHICH ORIGINS ARE LOOPBACK is a pure question and its table lives in
// `origin.test.ts`, where a row costs nothing. What is asked HERE is the other
// question — does every route branch actually go through the check — and that one
// needs a live server, so it gets exactly one case per branch and no spellings.
// `route`'s ladder has five, and a suite that only posted would not notice a check
// that had drifted into the POST branch.

const origin = (p: string, value: string, init: RequestInit = {}) =>
  fetch(url(p), { ...init, headers: { ...init.headers, origin: value } });

async function expectForbiddenOrigin(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = (await res.json()) as {
    error: { code: string; message: string };
  };
  expect(body.error.code).toBe("forbidden-origin");
}

const EVIL = "http://evil.example";

test("every route branch refuses a cross-origin request — all five", async () => {
  // 1. POST /api/* — the branch a check is most likely to be written into.
  await expectForbiddenOrigin(
    await origin("/api/project.get", EVIL, { method: "POST", body: "{}" }),
  );
  // 2. GET /api/events — this branch HIJACKS the response (`hub.subscribe(res)`
  //    writes its own headers and never ends), so a check placed after it would
  //    leak an open feed to the attacking page. The JSON content-type inside
  //    `expectForbiddenOrigin` is the half that proves no stream opened.
  await expectForbiddenOrigin(await origin("/api/events", EVIL));
  // 3. GET /engine.js — refused BEFORE the bundler runs, which is also why this
  //    case is fast where the engine.js success test is not.
  await expectForbiddenOrigin(await origin("/engine.js", EVIL));
  // 4. GET <anything else> — the static + project-asset branch.
  await expectForbiddenOrigin(await origin("/", EVIL));
  // 5. The no-route fallback, reached by method rather than by path.
  await expectForbiddenOrigin(
    await origin("/api/project.get", EVIL, { method: "DELETE" }),
  );
});

test("a loopback origin is served normally — the chrome's own case", async () => {
  const res = await origin(
    `/api/project.get`,
    `http://127.0.0.1:${server.port}`,
    {
      method: "POST",
      body: "{}",
    },
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ root: FIXTURE });
});

test("an ABSENT origin passes — curl, the CLI, a future MCP client send none", async () => {
  // Stated as its own pin because it is the clause that makes this a rebinding
  // defence rather than client auth. Every other test in this file relies on it,
  // so it asserts the BODY too: "not 403" would also be true of a 500.
  const res = await fetch(url("/api/project.get"), {
    method: "POST",
    body: "{}",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ root: FIXTURE });
});

// --- A request target that is not a URL --------------------------------------

test("a malformed request target answers 400 instead of killing the daemon", async () => {
  // `new URL("//", "http://localhost")` THROWS — `//` is a protocol-relative
  // reference with an empty host. The parse used to sit outside `route`'s try,
  // where the throw escaped an async function nobody awaits: Bun left the socket
  // open, and NODE 22 TOOK THE UNHANDLED REJECTION AS FATAL AND EXITED. Node's is
  // the behaviour that governs (the daemon must run on plain Node ≥20), so this
  // pins a remote unauthenticated process-kill closed.
  //
  // `fetch` normalizes these away, so the targets go over a raw socket verbatim.
  for (const target of ["//", "///////", "/\\"]) {
    const raw = await rawRequest(`GET ${target} HTTP/1.1`);
    expect(raw, `target ${JSON.stringify(target)}`).toContain("400");
    expect(raw).toContain("invalid-input");
  }
  // …and the server is still up afterwards, which is the whole point.
  const after = await fetch(url("/api/project.get"), {
    method: "POST",
    body: "{}",
  });
  expect(after.status).toBe(200);
});

test("the origin check runs BEFORE the target is parsed", async () => {
  // Both refusals are typed and both are correct, so the ORDER is the only thing
  // that decides which one a malformed cross-origin request gets. It must be the
  // security one: "one check runs ahead of every route" is a claim `editor-
  // architecture.md` §2 makes, and a 400 here would falsify it.
  const raw = await rawRequest(
    `GET // HTTP/1.1`,
    `Origin: http://evil.example`,
  );
  expect(raw).toContain("403");
  expect(raw).toContain("forbidden-origin");
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
