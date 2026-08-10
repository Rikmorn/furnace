// The CHROME's half of `viewport.capture` — the answerer row, on its own.
//
// HERE AND NOT IN `tests/chrome/`, which is where `session.state`'s row is pinned, because
// this row needs no shell and no DOM: it reads a ref, calls one host verb and encodes the
// result. `tests/chrome/session-state.test.tsx` mounts a real shell precisely because the
// thing under test there is which MIRRORS the projection reads; there are no mirrors here.
// Staying out of that directory also keeps the file out of happy-dom's way — registering it
// replaces `globalThis.navigator` and takes `navigator.gpu` with it, which is why every GPU
// test in this package sits at this level.
//
// WHAT IT PINS is the conversion nobody else can see: bytes in, base64 out, at a size that
// actually exercises the chunking. The PICTURE is `tests/field-capture.gpu.test.ts`'; the
// RELAY is `tests/backchannel.test.ts`'; this is the hop in between.
import { expect, test } from "bun:test";
import type { CaptureImage, FieldHost } from "../src/field-host/index.ts";
import { createSessionAnswerers } from "../src/frontend/lib/session-answerers.ts";
import type { ViewportCaptureResult } from "../src/shared/wire.ts";

/** A host that records what it was asked and answers with `png`. */
function stubHost(png: Uint8Array): {
  host: FieldHost;
  asked: unknown[];
} {
  const asked: unknown[] = [];
  // Boundary cast: `viewport.capture` reaches exactly one member of the facade, and a
  // whole `FieldHost` here would be seventy stubs proving nothing about this row.
  const host = {
    captureScene: (req?: unknown): Promise<CaptureImage> => {
      asked.push(req);
      return Promise.resolve({ png, width: 320, height: 180, view: "+y" });
    },
  } as unknown as FieldHost;
  return { host, asked };
}

function row(host: FieldHost | undefined) {
  const answerers = createSessionAnswerers(
    { current: null },
    { current: host },
  );
  const handler = answerers["viewport.capture"];
  if (handler === undefined)
    throw new Error("test: no viewport.capture answerer");
  return handler;
}

test("viewport.capture: the request travels through and the answer carries the size it got", async () => {
  const { host, asked } = stubHost(new Uint8Array([1, 2, 3]));
  const answer = (await row(host)({
    view: "+y",
    size: 320,
    overlays: false,
  })) as ViewportCaptureResult;
  // Passed through field by field rather than as the object it arrived in — so a row that
  // forwarded `params` wholesale (and with it any key the schema let by) would show here.
  expect(asked).toEqual([{ view: "+y", size: 320, overlays: false }]);
  expect(answer.width).toBe(320);
  expect(answer.height).toBe(180);
  expect(answer.view).toBe("+y");
});

test("viewport.capture: absent params are the empty request, not a crash", async () => {
  // The daemon's schema permits `{}` and every field is optional, so this is a REACHABLE
  // call rather than a defensive one: `viewport_capture` with no arguments is the shape an
  // agent will use most.
  const { host, asked } = stubHost(new Uint8Array([9]));
  await row(host)(undefined);
  expect(asked).toEqual([
    { view: undefined, size: undefined, overlays: undefined },
  ]);
});

test("viewport.capture: THE ONE BASE64 HOP — a megabyte of PNG survives it byte for byte", async () => {
  // A real capture is ~0.5–1.5 MB, and the encoder that breaks at that size passes every
  // small fixture: `String.fromCharCode(...bytes)` spreads one argument per byte and blows
  // the argument limit somewhere in the tens of thousands. So the pin is a payload PAST
  // the chunk size, decoded back and compared — not a spot check on four bytes.
  const png = new Uint8Array(1_000_003);
  for (let i = 0; i < png.length; i++) png[i] = (i * 31 + (i >> 8)) & 0xff;
  const answer = (await row(stubHost(png).host)({})) as ViewportCaptureResult;
  const back = Uint8Array.from(atob(answer.png), (c) => c.charCodeAt(0));
  expect(back.length).toBe(png.length);
  expect(back).toEqual(png);
});

test("viewport.capture: a chrome with no engine REFUSES rather than answering with a blank", async () => {
  // The opposite posture from `session.state`, which answers `{ ready: false }` for the
  // same tab. That method has a truthful answer for a chrome with no engine; this one does
  // not — there is no picture of a viewport that does not exist, and a blank image would be
  // a positive claim about what the human is looking at. `useSessionAnswer` turns the throw
  // into a typed refusal the caller reads.
  await expect(row(undefined)({})).rejects.toThrow(/no engine yet/);
});
