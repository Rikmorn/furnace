import { expect, test } from "bun:test";
import type { ServerResponse } from "node:http";
import { createEventHub, type DaemonEvent } from "../src/daemon/events.ts";
// Type-only, and deliberately so: this is the only file that names both sides of the
// feed, and an `import type` is erased before it can pull the frontend module (and its
// DOM globals) into a daemon test process.
import type { ServerEvent } from "../src/frontend/lib/events.ts";

type FakeRes = {
  chunks: string[];
  headers?: Record<string, string>;
  closeHandlers: (() => void)[];
  res: ServerResponse;
};

function fakeRes(): FakeRes {
  const fake: FakeRes = {
    chunks: [],
    closeHandlers: [],
    res: undefined as never,
  };
  // Boundary cast: the hub only calls writeHead/write/end/on("close") — a
  // minimal structural fake stands in for a real ServerResponse in unit tests.
  fake.res = {
    writeHead(_status: number, headers: Record<string, string>) {
      fake.headers = headers;
      return fake.res;
    },
    write(chunk: string) {
      fake.chunks.push(chunk);
      return true;
    },
    end() {
      // no-op: hub only calls end() on close; nothing to flush in the fake
    },
    on(event: string, handler: () => void) {
      if (event === "close") fake.closeHandlers.push(handler);
      return fake.res;
    },
  } as unknown as ServerResponse;
  return fake;
}

/** `true` only if the two unions are mutually assignable — one-way would let either
 *  side grow an arm the other has never heard of. Tuple-wrapped so a union distributes
 *  as a whole rather than member by member. */
type Mirrors<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

test("the frontend's event union mirrors the daemon's, arm for arm", () => {
  // Enforced by `bun run typecheck`, not by this run: drift makes the annotation `false`
  // and the assignment below a compile error. It lives in a test because that is where
  // someone looks when the two files disagree — the frontend mirrors DaemonEvent by
  // hand (it cannot import daemon types), and a name that exists on only one side is a
  // silent dead event, not a crash.
  const mirrored: Mirrors<DaemonEvent, ServerEvent> = true;
  expect(mirrored).toBe(true);
});

test("subscribe sends SSE headers; emit broadcasts a typed event frame", () => {
  const hub = createEventHub();
  const a = fakeRes();
  const b = fakeRes();
  hub.subscribe(a.res);
  hub.subscribe(b.res);
  expect(a.headers?.["content-type"]).toBe("text/event-stream");
  hub.emit({ type: "saved", revision: 3 });
  const frame = a.chunks.at(-1);
  expect(frame).toContain("event: saved\n");
  expect(frame).toContain('data: {"type":"saved","revision":3}');
  expect(b.chunks.at(-1)).toBe(frame);
  hub.close();
});

test("a closed subscriber stops receiving", () => {
  const hub = createEventHub();
  const a = fakeRes();
  hub.subscribe(a.res);
  for (const h of a.closeHandlers) h();
  const before = a.chunks.length;
  hub.emit({ type: "saved", revision: 1 });
  expect(a.chunks.length).toBe(before);
  hub.close();
});
