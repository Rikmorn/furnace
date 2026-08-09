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
  // 2. GET /api/events — this branch HIJACKS the response (`hub.subscribe(req, res)`
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

// --- The session claim, WIRED (foundations T4b) -------------------------------
//
// What the table DOES lives in `tests/claims.test.ts`, where a case costs nothing. What
// is asked HERE is the half only a live server can answer: that a POST — a different
// HTTP request from the stream it speaks for — reaches the right connection at all. The
// token is read off the wire, not handed over by a fixture, because "the chrome can get
// this" is exactly the claim being made.

const TOKEN_IN_FRAME = /"token":"([^"]+)"/;

/** One live feed, over a RAW SOCKET rather than `fetch` + `AbortController`.
 *
 *  Two reasons, and the second is the one that forced it. (1) Destroying a socket is
 *  literally what a browser tab does when it goes away, which is the departure the claim's
 *  whole lifetime hangs on. (2) `AbortController` here is not necessarily Bun's:
 *  `tests/gpu-fixture-survives-dom.test.ts` registers happy-dom in this same process and
 *  restores only `fetch`, `createImageBitmap` and `ImageData` — so a full-suite run leaves
 *  happy-dom's `AbortController` standing, Bun's `fetch` does not honour a foreign signal,
 *  and `abort()` silently tears nothing down. Measured: the stale-token case below passes
 *  alone and hangs its poll out in a whole-package run. A socket has no such ambiguity. */
type Feed = {
  token: string;
  /** Everything the daemon has written to this connection so far. */
  text(): string;
  /** Resolve once `needle` has arrived on this connection. */
  until(needle: string, timeoutMs?: number): Promise<string>;
  /** Kill it the way a closing tab does. */
  hangUp(): void;
};

function openFeed(): Promise<Feed> {
  return new Promise((done, fail) => {
    const socket = connect(server.port, "127.0.0.1", () => {
      socket.write("GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    });
    let text = "";
    const waiting: { needle: string; hit: (text: string) => void }[] = [];
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      for (let i = waiting.length - 1; i >= 0; i--) {
        const w = waiting[i];
        if (w && text.includes(w.needle)) {
          waiting.splice(i, 1);
          w.hit(text);
        }
      }
    });
    socket.on("error", fail);

    const until = (needle: string, timeoutMs = 8000): Promise<string> =>
      new Promise((hit, miss) => {
        if (text.includes(needle)) {
          hit(text);
          return;
        }
        const timer = setTimeout(
          () =>
            miss(
              new Error(`no ${needle} within ${timeoutMs}ms; got:\n${text}`),
            ),
          timeoutMs,
        );
        waiting.push({
          needle,
          hit: (t) => {
            clearTimeout(timer);
            hit(t);
          },
        });
      });

    until("event: session-token").then((first) => {
      const token = TOKEN_IN_FRAME.exec(first)?.[1];
      if (token === undefined) {
        fail(new Error(`no token in the first frame:\n${first}`));
        return;
      }
      done({
        token,
        text: () => text,
        until,
        hangUp: () => socket.destroy(),
      });
    }, fail);
  });
}

const post = (command: string, body: unknown) =>
  fetch(url(`/api/${command}`), { method: "POST", body: JSON.stringify(body) });

async function errorBody(
  res: Response,
): Promise<{ code: string; message: string }> {
  const body = (await res.json()) as {
    error: { code: string; message: string };
  };
  return body.error;
}

test("a claim is asserted BY the connection the daemon named", async () => {
  const feed = await openFeed();
  try {
    const claimed = await post("session.claim", {
      name: "cavern",
      token: feed.token,
    });
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({});
    // Re-asserting on the same connection is granted, not a conflict with itself.
    expect(
      (await post("session.claim", { name: "cavern", token: feed.token }))
        .status,
    ).toBe(200);
    // …and releasing hands the world back without closing the tab.
    expect((await post("session.release", { token: feed.token })).status).toBe(
      200,
    );
  } finally {
    feed.hangUp();
  }
});

test("a token naming no live connection → 409 no-session, never a hang", async () => {
  // Both flavours, because they arrive by different routes and a client can only act on
  // the answer if it is the same one: a token this daemon never minted (a tab left over
  // from a previous daemon, a typo) and a token whose feed has since closed — the
  // ordinary reconnect, where a POST loses the race with its own stream.
  const invented = await post("session.claim", {
    name: "cavern",
    token: "00000000-0000-4000-8000-000000000000",
  });
  expect(invented.status).toBe(409);
  expect((await errorBody(invented)).code).toBe("no-session");

  const feed = await openFeed();
  feed.hangUp();
  // The daemon notices within milliseconds (3.5 ms measured at the T4b Task 0 spike, and
  // `req.on("close")` is what carries it on this runtime), but a poll states a CONDITION
  // where a sleep would state a guess.
  let stale: Response | undefined;
  for (let attempt = 0; attempt < 40; attempt++) {
    stale = await post("session.claim", { name: "cavern", token: feed.token });
    if (stale.status === 409) break;
    await stale.text();
    await new Promise((done) => setTimeout(done, 50));
  }
  expect(stale?.status).toBe(409);
  expect(await errorBody(stale as Response)).toEqual({
    code: "no-session",
    message:
      "no live editor connection for that token — the editor's event feed mints a new one on every (re)connect",
  });
}, 20_000);

test("a second session is refused, steals, and the loser is TOLD over its own feed", async () => {
  const holder = await openFeed();
  const rival = await openFeed();
  try {
    expect(
      (await post("session.claim", { name: "grotto", token: holder.token }))
        .status,
    ).toBe(200);

    const refused = await post("session.claim", {
      name: "grotto",
      token: rival.token,
    });
    expect(refused.status).toBe(409);
    const error = await errorBody(refused);
    expect(error.code).toBe("already-exists");
    // The message carries the remedy, which is the half that differs from a taken
    // directory name — same code, a different way out.
    expect(error.message).toContain("steal it");

    expect(
      (await post("session.steal", { name: "grotto", token: rival.token }))
        .status,
    ).toBe(200);

    // ADDRESSED, not broadcast: the loser hears it and the winner does not.
    expect(await holder.until("event: claim-lost")).toContain(
      'data: {"type":"claim-lost","world":"grotto"}',
    );
    expect(rival.text()).not.toContain("claim-lost");
  } finally {
    holder.hangUp();
    rival.hangUp();
  }
}, 20_000);

test("the untitled session claims under `null`, and collides with no world name", async () => {
  const feed = await openFeed();
  try {
    expect(
      (await post("session.claim", { name: null, token: feed.token })).status,
    ).toBe(200);
    // A MISSING `name` is a malformed request rather than a null one: the schema's field
    // is required-and-nullable, so "I am editing nothing yet" has to be stated.
    const omitted = await post("session.claim", { token: feed.token });
    expect(omitted.status).toBe(400);
    expect((await errorBody(omitted)).code).toBe("invalid-input");
  } finally {
    feed.hangUp();
  }
});

test("a hang-up frees the world for the NEXT connection, with no steal", async () => {
  // THE PRODUCTION WIRING, and it needs its own case: `tests/claims.test.ts` builds its
  // own hub/claims pair the way `startServer` does, so it proves the two modules compose
  // and NOT that `startServer` actually composed them. Cutting `hub.onClose(… release …)`
  // in `server.ts` reddens nothing else in the suite — measured, which is why this exists.
  //
  // It is also the reconnect design's whole premise as an end-to-end claim: a tab that
  // goes away leaves its world unheld, so the tab that comes back CLAIMS rather than
  // steals, and no human is asked a question.
  const first = await openFeed();
  expect(
    (await post("session.claim", { name: "vault", token: first.token })).status,
  ).toBe(200);
  first.hangUp();

  const second = await openFeed();
  try {
    let retaken: Response | undefined;
    for (let attempt = 0; attempt < 40; attempt++) {
      retaken = await post("session.claim", {
        name: "vault",
        token: second.token,
      });
      if (retaken.status === 200) break;
      await retaken.text();
      await new Promise((done) => setTimeout(done, 50));
    }
    expect(retaken?.status).toBe(200);
  } finally {
    second.hangUp();
  }
}, 20_000);
