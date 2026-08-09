import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngineBundler, type EngineBundler } from "./bundle.ts";
import { createClaims } from "./claims.ts";
import { loadConfig } from "./config.ts";
import { EditorError, httpStatus } from "./errors.ts";
import { createEventHub } from "./events.ts";
import { createHandlers, dispatch, type Handlers } from "./handlers.ts";
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
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
  const handlers: Handlers = createHandlers({
    root: opts.root,
    emit: (event) => hub.emit(event),
    isTracked: createGitTrackedChecker(opts.root),
    session: { claims, connectionFor: (token) => hub.connectionFor(token) },
  });
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
