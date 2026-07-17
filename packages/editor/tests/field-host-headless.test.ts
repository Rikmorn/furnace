// FieldHost surfaces that need NO GPU init (a field-host-load.test.ts
// sibling): startStamp's no-selection guard, subscribeStamp's initial push,
// and highlightEntity's unknown-id quiet no-op. Verified against the host
// source: none of these paths touch the GPU context, the render loop, or the
// lazily-spawned remesh worker — startStamp returns at the selection guard
// BEFORE any session/preview work, and highlightEntity only scans the op log.
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

test("highlightEntity is runtime-quiet on unknown ids and null", () => {
  const host = createFieldHost();
  expect(() => host.highlightEntity(999)).not.toThrow();
  expect(() => host.highlightEntity(null)).not.toThrow();
});
