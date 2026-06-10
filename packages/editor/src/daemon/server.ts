import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createEngineBundler, type EngineBundler } from "./bundle.ts";
import { loadConfig } from "./config.ts";
import {
  ApiError,
  createHandlers,
  dispatch,
  type Handlers,
} from "./handlers.ts";

export type ServerOptions = { root: string; port: number };
export type RunningServer = { port: number; close(): void };

const PLACEHOLDER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>furnace editor</title></head>
<body><h1>furnace editor</h1><p>The editor chrome lands in M3 Plan B. The daemon is running:
<code>POST /api/scene.list</code> · <code>POST /api/scene.read</code> · <code>GET /engine.js</code></p></body></html>`;

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
  const handlers: Handlers = createHandlers({
    root: opts.root,
    scenesPattern: config.scenes,
  });
  const bundler: EngineBundler = await createEngineBundler(
    opts.root,
    config.extensions,
  );

  const server = createServer((req, res) => {
    void route(req, res);
  });

  async function route(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(PLACEHOLDER_HTML);
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
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        const command = url.pathname.slice("/api/".length);
        const bodyText = await readBody(req);
        let input: unknown;
        try {
          input = bodyText === "" ? {} : JSON.parse(bodyText);
        } catch {
          sendJson(res, 400, { error: "request body is not valid JSON" });
          return;
        }
        sendJson(res, 200, await dispatch(handlers, command, input));
        return;
      }
      sendJson(res, 404, {
        error: `no route for ${req.method} ${url.pathname}`,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        sendJson(res, err.code, { error: err.message });
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: detail });
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
      void bundler.dispose();
    },
  };
}
