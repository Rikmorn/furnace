// The presence store, on its own — what the chrome records when an agent verb runs
// (foundations T4c, Task 5).
//
// A BARE UNIT, the `notify-store.test.ts` shape and for the same reason: the store is
// framework-free, so what it records and what it publishes are decidable with no DOM, no
// clock and no React. The seam that CALLS it is pinned in `tests/chrome/session-answer.test.tsx`
// (which method records and which does not), and the surface that READS it in
// `tests/chrome/shell.test.tsx`.
import { expect, test } from "bun:test";
import { createAgentPresence } from "../src/frontend/lib/agent-presence.ts";

test("a fresh tab has had no agent in it", () => {
  expect(createAgentPresence().getSnapshot()).toEqual({ verb: null, count: 0 });
});

test("the last verb wins and the count climbs", () => {
  const presence = createAgentPresence();
  presence.ran("session.state");
  presence.ran("edit.apply");
  expect(presence.getSnapshot()).toEqual({ verb: "edit.apply", count: 2 });
});

test("a REPEATED verb still moves the snapshot — the count is what makes it visible", () => {
  // An agent polling one method is the commonest shape of all, and an indicator that never
  // changed under it would read as an agent that has left. The count is the whole of what
  // makes repeat activity legible, which is why it is a field rather than a nicety.
  const presence = createAgentPresence();
  presence.ran("session.state");
  const first = presence.getSnapshot();
  presence.ran("session.state");
  expect(presence.getSnapshot()).toEqual({ verb: "session.state", count: 2 });
  expect(presence.getSnapshot()).not.toBe(first);
});

test("the snapshot is IDENTITY-STABLE between records", () => {
  // `useSyncExternalStore` compares getSnapshot's RESULT by identity: a fresh object per call
  // re-renders every consumer on every render, for ever. `notify-store.ts` states the rule and
  // this is the same trap one module over.
  const presence = createAgentPresence();
  presence.ran("generate");
  expect(presence.getSnapshot()).toBe(presence.getSnapshot());
});

test("subscribers hear every record, and a released one hears nothing", () => {
  const presence = createAgentPresence();
  let heard = 0;
  const release = presence.subscribe(() => {
    heard++;
  });
  presence.ran("session.query");
  presence.ran("viewport.capture");
  expect(heard).toBe(2);
  release();
  presence.ran("session.interrupt");
  expect(heard).toBe(2);
  // …and the store still recorded it: a listener leaving is not a reason to stop knowing.
  expect(presence.getSnapshot().verb).toBe("session.interrupt");
});

test("two stores are two tabs — nothing is shared but the shape", () => {
  // THE PROPERTY THAT MADE THIS A FACTORY RATHER THAN A SINGLETON, and it was bought with a
  // failure: the first cut exported one module-level store, and the full suite caught a chrome
  // case asserting "no agent has been here" against a verb an earlier test FILE had recorded
  // — every suite in this process shares one module registry. `App` holds the store now
  // (`useState(createAgentPresence)`) and hands it down the context, so a second shell is a
  // second tab in the way the chrome's own cells already require.
  const a = createAgentPresence();
  const b = createAgentPresence();
  a.ran("edit.apply");
  expect(b.getSnapshot()).toEqual({ verb: null, count: 0 });
});
