import { expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createEventHub, type DaemonEvent } from "../src/daemon/events.ts";
// Type-only, and deliberately so: this is the only file that names both sides of the
// feed, and an `import type` is erased before it can pull the frontend module (and its
// DOM globals) into a daemon test process. `EVENT_TYPES` rides the same erased import
// though it is declared as a value — `typeof EVENT_TYPES` is a type query, so the
// subscription-list pin below reads the array's shape without the module ever loading.
import type { EVENT_TYPES, ServerEvent } from "../src/frontend/lib/events.ts";

type FakeRes = {
  chunks: string[];
  headers?: Record<string, string>;
  /** Every departure handler the hub registered, on the response AND on the request.
   *  Both, because `res.on("close")` never fires under Bun and `req.on("close")` fires
   *  under both — measured at T4b Task 2 and argued at `subscribe`. Firing the whole
   *  list is how a case says "the client left", whichever half a runtime would report
   *  it on. */
  closeHandlers: (() => void)[];
  req: IncomingMessage;
  res: ServerResponse;
};

function fakeRes(): FakeRes {
  const fake: FakeRes = {
    chunks: [],
    closeHandlers: [],
    req: undefined as never,
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
  // Boundary cast: the hub asks the request for nothing but its close event.
  fake.req = {
    on(event: string, handler: () => void) {
      if (event === "close") fake.closeHandlers.push(handler);
      return fake.req;
    },
  } as unknown as IncomingMessage;
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
  //
  // What it catches, measured: a missing or extra ARM, and a changed or added REQUIRED
  // field. What it does NOT catch: an OPTIONAL field added to one side only — both
  // directions stay assignable, so the guard passes while a payload the client never
  // reads rides the wire. Add such a field to both unions by hand.
  const mirrored: Mirrors<DaemonEvent, ServerEvent> = true;
  expect(mirrored).toBe(true);
});

test("the SUBSCRIPTION list covers every arm — the half the union pin cannot see", () => {
  // THE HOLE THIS CLOSES, and it is the worst-behaved kind. An `EventSource` delivers only
  // the names it was asked for, so an arm added to both unions but not to `EVENT_TYPES`
  // type-checks, ships, and silently never arrives — no error, no listener, no symptom
  // anywhere but the feature that quietly does nothing. The pin above cannot see it: it
  // compares two TYPES, and `EVENT_TYPES` is an array of strings.
  //
  // Mutual, like its neighbour, and both directions earn their keep: a missing row is the
  // dead-event bug, and an EXTRA row is a listener for a frame the daemon stopped emitting
  // — dead code that reads as live wiring. `as const` is what makes the array's element
  // type readable as a union at all, which is why the declaration carries it.
  //
  // Enforced by `bun run typecheck` rather than by this run, exactly as the union pin is:
  // drift makes the annotation `false` and the assignment a compile error.
  const listed: Mirrors<ServerEvent["type"], (typeof EVENT_TYPES)[number]> =
    true;
  expect(listed).toBe(true);
});

test("subscribe sends SSE headers; emit broadcasts a typed event frame", () => {
  const hub = createEventHub();
  const a = fakeRes();
  const b = fakeRes();
  hub.subscribe(a.req, a.res);
  hub.subscribe(b.req, b.res);
  expect(a.headers?.["content-type"]).toBe("text/event-stream");
  hub.emit({ type: "generation-baked", files: 3 });
  const frame = a.chunks.at(-1);
  expect(frame).toContain("event: generation-baked\n");
  expect(frame).toContain('data: {"type":"generation-baked","files":3}');
  expect(b.chunks.at(-1)).toBe(frame);
  hub.close();
});

test("a closed subscriber stops receiving", () => {
  const hub = createEventHub();
  const a = fakeRes();
  hub.subscribe(a.req, a.res);
  for (const h of a.closeHandlers) h();
  const before = a.chunks.length;
  hub.emit({ type: "worlds-changed" });
  expect(a.chunks.length).toBe(before);
  hub.close();
});
