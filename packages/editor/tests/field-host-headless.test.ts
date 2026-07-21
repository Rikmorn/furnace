// FieldHost surfaces that need NO GPU init (a field-host-load.test.ts
// sibling): startStamp's no-selection guard, subscribeStamp's initial push,
// nudgeStamp's no-session no-op, and highlightEntity's unknown-id quiet no-op.
// Verified against the host source: none of these paths touch the GPU context,
// the render loop, or the lazily-spawned remesh worker — startStamp returns at
// the selection guard BEFORE any session/preview work, nudgeStamp returns at
// its own session guard BEFORE nudgeRegion/previewStamp, and highlightEntity
// only scans the op log.
import { expect, test } from "bun:test";
import { createFieldHost } from "../src/viewport-host/field-host.ts";

test("startStamp with no selection reports 'select a region first' and opens no session", () => {
  const host = createFieldHost();
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const pushes: unknown[] = [];
  host.subscribeStamp((s) => pushes.push(s));
  host.startStamp("hall");
  expect(errors).toEqual(["select a region first"]);
  // Only the initial subscribe push — the failed start must not notify.
  expect(pushes).toEqual([null]);
});

test("subscribeStamp immediately pushes the current state (null without a session)", () => {
  const host = createFieldHost();
  let pushed: unknown = "not-pushed";
  host.subscribeStamp((s) => {
    pushed = s;
  });
  expect(pushed).toBeNull();
});

test("nudgeStamp without a session is a quiet no-op (no push, no preview)", () => {
  const host = createFieldHost();
  const pushes: unknown[] = [];
  host.subscribeStamp((s) => pushes.push(s));
  expect(() => host.nudgeStamp(1, 0, -1)).not.toThrow();
  // Only the initial subscribe push — a session-less nudge must not notify
  // (a notify would mean it reached previewStamp and the worker spawn).
  expect(pushes).toEqual([null]);
});

test("highlightEntity is runtime-quiet on unknown ids and null", () => {
  const host = createFieldHost();
  expect(() => host.highlightEntity(999)).not.toThrow();
  expect(() => host.highlightEntity(null)).not.toThrow();
});
