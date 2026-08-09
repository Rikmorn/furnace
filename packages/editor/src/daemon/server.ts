import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackchannel } from "./backchannel.ts";
import { createEngineBundler, type EngineBundler } from "./bundle.ts";
import { createClaims } from "./claims.ts";
import { loadConfig } from "./config.ts";
import { EditorError, httpStatus } from "./errors.ts";
import { createEventHub } from "./events.ts";
import { createHandlers, dispatch, type Handlers } from "./handlers.ts";
import { createMcpDoor, MCP_PATH, type McpDoor } from "./mcp.ts";
import { assertLoopbackOrigin } from "./origin.ts";
import { chokidarWatchDir, type WatchDir } from "./watch.ts";

export type ServerOptions = {
  root: string;
  port: number;
  staticDir?: string;
  watchDir?: WatchDir;
};
export type RunningServer = { port: number; close(): void };

const DEFAULT_STATIC_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../dist/frontend",
);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Resolve `pathname` to an existing regular file under `baseDir` ("/" → index.html),
 *  or undefined when it escapes the base or doesn't exist. */
function resolveFile(baseDir: string, pathname: string): string | undefined {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const abs = normalize(join(baseDir, rel));
  if (!abs.startsWith(normalize(baseDir))) return undefined;
  if (!existsSync(abs) || !statSync(abs).isFile()) return undefined;
  return abs;
}

function streamFile(abs: string, res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(abs)] ?? "application/octet-stream",
  });
  const stream = createReadStream(abs);
  // pipe() does not forward read errors; abort the response so the connection
  // doesn't hang if the file errors mid-stream (headers are already sent).
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function serveStatic(
  staticDir: string,
  pathname: string,
  res: ServerResponse,
): void {
  if (!existsSync(staticDir)) {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end(
      "editor chrome not built — run `bun run --cwd packages/editor build:frontend` (or reinstall @furnace/editor)",
    );
    return;
  }
  const abs = resolveFile(staticDir, pathname);
  if (abs === undefined) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not found: ${pathname}`);
    return;
  }
  streamFile(abs, res);
}

/** Serve a project file for a GET the chrome doesn't own. Projects reference asset
 *  sidecars by root-absolute URL (e.g. the dungeon's `/catalog/*.fmesh`), which the
 *  browser-side loader fetches same-origin — the daemon mirrors the consumer dev
 *  server's layout by mapping the path onto the project root (found live at the 3.0
 *  gate: a `.fmesh` sidecar 404'd). Root-contained; dotfile segments and
 *  node_modules are refused (the daemon is localhost single-user, but `.env` must
 *  never be one GET away). Returns false when not served. */
function serveProjectAsset(
  root: string,
  pathname: string,
  res: ServerResponse,
): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded === "/" || decoded === "") return false;
  const segments = decoded.slice(1).split("/");
  if (segments.some((s) => s.startsWith(".") || s === "node_modules")) {
    return false;
  }
  const abs = resolveFile(root, decoded);
  if (abs === undefined) return false;
  streamFile(abs, res);
  return true;
}

/** The request target as a URL, or a typed 400 when it does not parse.
 *
 *  `new URL(target, base)` THROWS on a request target the HTTP parser accepts — `//`,
 *  `///////`, `/\` are each a protocol-relative reference with an empty host, which is
 *  not a URL. That is not theoretical reach: it is one `fetch("//")` from the same
 *  rebinding page the origin check models, and it needs no header the attacker cannot
 *  set. Until T4a the parse sat OUTSIDE `route`'s try, where the throw escaped an
 *  `async` function nobody awaits — **measured 2026-08-09: Bun leaves the socket open
 *  with no response; Node 22 takes the unhandled rejection as fatal and KILLS THE
 *  PROCESS.** Node's is the behaviour that governs, since the daemon must run on plain
 *  Node ≥20.
 *
 *  `invalid-input` rather than a code of its own: the existing one already means "the
 *  client sent something this daemon will not accept", `invalid-json` is its exact
 *  sibling one layer in, and a malformed request target earns no new contract surface.
 *
 *  @throws {@link EditorError} `invalid-input` (400) when the target does not parse. */
function requestUrl(req: IncomingMessage): URL {
  const target = req.url ?? "/";
  try {
    return new URL(target, "http://localhost");
  } catch {
    throw new EditorError(
      "invalid-input",
      `request target is not a URL: ${JSON.stringify(target)}`,
    );
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  // No body-size cap by design: the daemon binds 127.0.0.1 and serves one local
  // single-user editor session — authentication and non-localhost access are
  // both out of scope (`editor-architecture.md` §2). Revisit if it ever accepts
  // non-localhost connections. (The "§9" this cited from the daemon's first
  // commit until T4a was a section of a gitignored spec — `editor-architecture.md`
  // did not exist yet — so it had always resolved against the wrong document.)
  return new Promise((resolvePromise, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
    });
    req.on("end", () => resolvePromise(data));
    req.on("error", reject);
  });
}

/**
 * Write one JSON response — and **never a body that says `application/json` and is not.**
 *
 * The `?? "null"` is the whole of that promise and it is not defensive. `JSON.stringify`
 * returns the VALUE `undefined` (not the string) for `undefined`, so `res.end(undefined)`
 * ends the response with nothing: a 200, a JSON content-type, and zero bytes, which every
 * client's `res.json()` throws on. Measured against a real `startServer` — it is the actual
 * outcome, not a hazard on paper.
 *
 * It became reachable at T4b: `session.state` is the FIRST command whose return value is
 * caller-controlled (every other handler returns a literal it wrote itself), and it relays
 * whatever the claimed chrome answered. `session.answer`'s schema deliberately accepts a
 * body with `payload` ABSENT — `session-handlers.ts` argues at length that this is the
 * canonical serialization of a handler that answered `undefined`, which any answerer in any
 * language produces — so the ask resolves `undefined` and it arrives here.
 *
 * FIXED AT THIS EDGE RATHER THAN AT THE RELAY, deliberately. A `?? null` inside
 * `session.state` would put the rule in one command, and the next command that relays a
 * caller's value would have to reproduce it to be understood — the same argument that makes
 * `dispatch` a single funnel for input. This function is where the content-type is DECIDED,
 * so it is where "the body matches the header" belongs. It changes nothing for the twelve
 * commands that return literals: none of them can produce `undefined`, so the coalesce is
 * unreachable for every one of them and the blast radius is exactly the new surface.
 *
 * `null` rather than `{}`: the ask really did resolve nothing, and JSON's spelling of
 * nothing is `null`. `{}` would invent an empty answer, which is the class of lie this
 * tranche exists to remove.
 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body) ?? "null";
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

/** Production adapter for HandlerContext.isTracked: probes ONCE whether `root`
 *  is inside a git work tree; when it isn't (git absent, or the project was
 *  just scaffolded with no repo yet), returns undefined so world.list reports
 *  every row's `tracked` as null instead of guessing. When a repo IS found,
 *  the returned closure shells out to `git check-ignore` per call: exit 1
 *  (not ignored) ⇒ true; exit 0 (ignored) ⇒ false; any other status (a git
 *  error, or a per-call spawn failure) ⇒ null (indeterminate). A null row
 *  degrades to no tracked/scratch badge, and any overwrite-confirmation flow
 *  built on this field must treat null the same as "don't warn" — the
 *  failure direction is silence, never a false claim that a tracked world is
 *  safe to overwrite. */
function createGitTrackedChecker(
  root: string,
): ((rel: string) => boolean | null) | undefined {
  const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
  });
  if (probe.error || probe.status !== 0) return undefined;
  return (rel: string) => {
    const status = spawnSync("git", ["check-ignore", "-q", rel], {
      cwd: root,
    }).status;
    if (status === 1) return true;
    if (status === 0) return false;
    return null;
  };
}

/** Start the editor daemon for one project root. `port: 0` lets the OS pick (tests). */
export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const config = loadConfig(opts.root);
  const hub = createEventHub();
  // The claim table's whole lifetime, in two lines (foundations T4b). The hub's close
  // hook is the daemon's ONE liveness signal, so a claim ends when the connection that
  // asserted it does — that is the reconciliation with "the daemon stays stateless":
  // this table is the same class of thing as the subscriber set (`daemon/claims.ts`
  // states it in full). Nothing persists it and nothing reloads it; a restart begins
  // with an empty table because a restart begins with an empty hub.
  const claims = createClaims();
  hub.onClose((connection) => claims.release(connection));
  // A steal tells the connection it displaced, and ONLY that one. Addressed rather than
  // broadcast because a broadcast would blank the tab that just won the world.
  claims.onDrop((connection, world) =>
    hub.emitTo(connection, { type: "claim-lost", world }),
  );
  // The relay to the claimed chrome (foundations T4b): one line, because it is handed both
  // halves and wires its OWN departure listener — unlike the claim table two lines up,
  // which knows nothing of hubs. That asymmetry is argued at `createBackchannel`; what it
  // buys here is that there is no third wire for this function to forget.
  const backchannel = createBackchannel(hub, claims);
  const handlers: Handlers = createHandlers({
    root: opts.root,
    emit: (event) => hub.emit(event),
    isTracked: createGitTrackedChecker(opts.root),
    session: {
      claims,
      connectionFor: (token) => hub.connectionFor(token),
      backchannel,
    },
  });
  // The agent door (foundations T4b), handed the same registry every other client uses — it
  // projects three of its commands as tools and computes nothing (`daemon/mcp.ts`). One line
  // here because ALL the transport is in that module: the SDK-v2 migration rewrites it and
  // must not have to come through the route table to do so.
  const mcp: McpDoor = createMcpDoor(handlers);
  const bundler: EngineBundler = await createEngineBundler(
    opts.root,
    config.extensions,
  );

  // Inner-loop staleness fix: /engine.js rebuilds per GET, but the browser must be
  // TOLD the source changed. Watch the extensions entry's directory (the consumer's
  // src/ by convention) and emit a dirty-bit; the frontend reloads when safe.
  const watchDirFn = opts.watchDir ?? chokidarWatchDir;
  const unwatchSource = config.extensions
    ? watchDirFn(dirname(resolve(opts.root, config.extensions)), () =>
        hub.emit({ type: "bundle-outdated" }),
      )
    : undefined;

  const server = createServer((req, res) => {
    void route(req, res);
  });

  async function route(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      // Both of these are INSIDE the try on purpose: the catch below is the daemon's
      // one typed-envelope edge, and a second emitter beside it would be a parallel
      // path to keep in step. The origin check is FIRST — ahead of every branch AND
      // ahead of parsing the target, so "one check runs before every route" is
      // literally true — which also covers the SSE subscribe (it hijacks the response)
      // and the static/asset GETs, neither of which would notice a check that only
      // guarded `POST /api/*`.
      assertLoopbackOrigin(req.headers.origin);
      const url = requestUrl(req);
      // THE AGENT DOOR, AND IT IS FIRST ON THE LADDER FOR A STRUCTURAL REASON (foundations
      // T4b). It is the only branch that matches on PATH ALONE — it owns every method on
      // `/mcp`, answering a POST through the transport and everything else with its own 405
      // — where every branch below is a (method, path) pair. A path-only branch has to
      // precede the method-only ones or they eat it: `GET <anything else>` FOUR branches down
      // is greedy, so a `/mcp` mounted after it would have its GET answered as a missing
      // static file, and the 405 that tells a client this endpoint opens no stream would be
      // unreachable. First is the position where that cannot be reintroduced by a later
      // branch, rather than merely not true today.
      //
      // The origin check still runs ahead of it, and costs MCP nothing: an SDK client sends
      // no `Origin` at all (measured at T4b Task 0), which `origin.ts`'s absent-origin clause
      // admits by the argument it already makes.
      if (url.pathname === MCP_PATH) {
        await mcp.handle(req, res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/engine.js") {
        const result = await bundler.build();
        if (!result.ok) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end(result.error);
          return;
        }
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
        });
        res.end(result.code);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        // BOTH halves: the hub watches `req` as well as `res` for the client's
        // departure, because `res`'s close event never fires under Bun — the runtime
        // this daemon is started on. Measured; argued at `subscribe`.
        hub.subscribe(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        const command = url.pathname.slice("/api/".length);
        const bodyText = await readBody(req);
        let input: unknown;
        try {
          input = bodyText === "" ? {} : JSON.parse(bodyText);
        } catch {
          sendJson(res, 400, {
            error: {
              code: "invalid-json",
              message: "request body is not valid JSON",
            },
          });
          return;
        }
        sendJson(res, 200, await dispatch(handlers, command, input));
        return;
      }
      if (req.method === "GET") {
        const staticDir = opts.staticDir ?? DEFAULT_STATIC_DIR;
        // Chrome wins ("/" + its assets); project files fill the misses so
        // root-absolute sidecar URLs a project emits (e.g. the dungeon's
        // /catalog/*.fmesh) resolve same-origin exactly as on the consumer's
        // own dev server.
        const chromeHit =
          existsSync(staticDir) &&
          resolveFile(staticDir, url.pathname) !== undefined;
        if (!chromeHit && serveProjectAsset(opts.root, url.pathname, res)) {
          return;
        }
        serveStatic(staticDir, url.pathname, res);
        return;
      }
      sendJson(res, 404, {
        error: {
          code: "not-found",
          message: `no route for ${req.method} ${url.pathname}`,
        },
      });
    } catch (err) {
      // **THE COMMITTED-RESPONSE GUARD, and it is required rather than defensive**
      // (foundations T4b). `mcp.handle` returns with the response already written — measured
      // at T4b Task 0, `res.headersSent` is true after every `handleRequest`, 12 of 12 — so
      // any throw from that point on arrives here over a response that can no longer be
      // given a status. `sendJson`'s `writeHead` then throws a SECOND time from inside the
      // daemon's one typed-envelope edge, and that throw escapes an `async` function nobody
      // awaits: the exact shape T4a's `requestUrl` closed, where **Node takes the unhandled
      // rejection as fatal and KILLS THE PROCESS** while the Bun runtime leaves the socket
      // open. Re-measured this session against both runtimes rather than inherited.
      //
      // `destroy()` rather than `end()`: the response is mid-body and there is no honest way
      // to append a refusal to a payload a client is already parsing. A torn connection is a
      // failure the client reports; a silently truncated JSON body is one it does not.
      //
      // NOTHING IN THE `/mcp` BRANCH THROWS AFTER `handleRequest` TODAY — the only calls in
      // that window are the transport's own `close()` pair, which do not — so this guard is
      // unpinnable by a black-box test and is kept on the same argument T4a's parse move
      // rests on: the cost is one branch, and the failure it forecloses is a remote,
      // unauthenticated daemon kill the day any code in that window learns to throw.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof EditorError) {
        sendJson(res, httpStatus(err.code), {
          error: { code: err.code, message: err.message },
        });
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: { code: "internal", message: detail } });
    }
  }

  await new Promise<void>((resolvePromise) =>
    server.listen(opts.port, "127.0.0.1", resolvePromise),
  );
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : opts.port;

  return {
    port,
    close() {
      server.close();
      unwatchSource?.();
      hub.close();
      void bundler.dispose();
    },
  };
}
