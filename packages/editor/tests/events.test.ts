import { expect, test } from "bun:test";
import type { ServerResponse } from "node:http";
import { createEventHub } from "../src/daemon/events.ts";

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
