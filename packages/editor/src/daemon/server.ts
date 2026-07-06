import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngineBundler, type EngineBundler } from "./bundle.ts";
import { loadConfig } from "./config.ts";
import { EditorError, httpStatus } from "./errors.ts";
import { createEventHub } from "./events.ts";
import { createHandlers, dispatch, type Handlers } from "./handlers.ts";
import { createRegistryLoader } from "./registry-bundle.ts";
import { createSession } from "./session.ts";
import { chokidarWatchDir, chokidarWatchFile, type WatchDir } from "./watch.ts";

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
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

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
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const abs = normalize(join(staticDir, rel));
  if (
    !abs.startsWith(normalize(staticDir)) ||
    !existsSync(abs) ||
    !statSync(abs).isFile()
  ) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not found: ${pathname}`);
    return;
  }
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(abs)] ?? "application/octet-stream",
  });
  const stream = createReadStream(abs);
  // pipe() does not forward read errors; abort the response so the connection
  // doesn't hang if the file errors mid-stream (headers are already sent).
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function readBody(req: IncomingMessage): Promise<string> {
  // No body-size cap by design: the daemon binds 127.0.0.1 and serves one local
  // single-user editor session (§9 out-of-scope: auth/non-localhost). Revisit if
  // it ever accepts non-localhost connections.
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

/** Start the editor daemon for one project root. `port: 0` lets the OS pick (tests). */
export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const config = loadConfig(opts.root);
  const registry = createRegistryLoader(opts.root, config.extensions);
  const hub = createEventHub();
  const session = createSession({
    root: opts.root,
    watchFile: chokidarWatchFile,
    registry,
    emit: (event) => hub.emit(event),
  });
  const handlers: Handlers = createHandlers({
    root: opts.root,
    scenesPattern: config.scenes,
    session,
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
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
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
        hub.subscribe(res);
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
        serveStatic(opts.staticDir ?? DEFAULT_STATIC_DIR, url.pathname, res);
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
      session.dispose();
      hub.close();
      void bundler.dispose();
    },
  };
}
