// One live SSE feed against a running daemon, over a RAW SOCKET rather than `fetch` +
// `AbortController`.
//
// Two reasons, and the second is the one that forced it. (1) Destroying a socket is literally
// what a browser tab does when it goes away, which is the departure the claim's whole lifetime
// hangs on. (2) `AbortController` here is not necessarily the test runtime's own:
// `tests/gpu-fixture-survives-dom.test.ts` registers happy-dom in this same process and
// restores only `fetch`, `createImageBitmap` and `ImageData` — so a full-suite run leaves
// happy-dom's `AbortController` standing, the runtime's `fetch` does not honour a foreign
// signal, and `abort()` silently tears nothing down. Measured: the stale-token case in
// `server.test.ts` passes alone and hangs its poll out in a whole-package run. A socket has no
// such ambiguity.
//
// EXTRACTED AT T4b Task 5, where the second caller arrived: `tests/mcp.test.ts` has to play
// the chrome exactly as `server.test.ts` does — the MCP door reads THROUGH a claimed session,
// so a truthful-payload pin needs a real claim on a real connection. It moved rather than
// being copied because the paragraph above is the whole value of it: a second copy is a second
// place for a measured hazard to be re-learned from the symptom.
import { connect } from "node:net";

const TOKEN_IN_FRAME = /"token":"([^"]+)"/;

export type Feed = {
  token: string;
  /** Everything the daemon has written to this connection so far. */
  text(): string;
  /** Resolve once `needle` has arrived on this connection. */
  until(needle: string, timeoutMs?: number): Promise<string>;
  /** Kill it the way a closing tab does. */
  hangUp(): void;
};

/** Open one feed against `port` and resolve once the daemon has named it. */
export function openFeed(port: number): Promise<Feed> {
  return new Promise((done, fail) => {
    const socket = connect(port, "127.0.0.1", () => {
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
