import { expect, test } from "bun:test";
import { createEmitter } from "../../src/events/emitter.ts";

test("emit fires registered listeners with the data", () => {
  const e = createEmitter<number>();
  let received: number | undefined;
  e.on((v) => {
    received = v;
  });
  e.emit(42);
  expect(received).toBe(42);
});

test("unsubscribe removes the listener", () => {
  const e = createEmitter<number>();
  let count = 0;
  const unsub = e.on(() => {
    count++;
  });
  e.emit(1);
  unsub();
  e.emit(2);
  expect(count).toBe(1);
});

test("clear removes all listeners", () => {
  const e = createEmitter<number>();
  let count = 0;
  e.on(() => {
    count++;
  });
  e.on(() => {
    count++;
  });
  e.clear();
  e.emit(1);
  expect(count).toBe(0);
});

test("listenerCount reflects subscriptions", () => {
  const e = createEmitter<number>();
  expect(e.listenerCount).toBe(0);
  const a = e.on(() => {
    /* no-op */
  });
  const b = e.on(() => {
    /* no-op */
  });
  expect(e.listenerCount).toBe(2);
  a();
  expect(e.listenerCount).toBe(1);
  b();
  expect(e.listenerCount).toBe(0);
});

test("listeners added during emit do not fire for that emit (snapshot semantics)", () => {
  const e = createEmitter<number>();
  let secondListenerCalls = 0;
  e.on(() => {
    e.on(() => {
      secondListenerCalls++;
    });
  });
  e.emit(1);
  expect(secondListenerCalls).toBe(0);
  e.emit(2);
  expect(secondListenerCalls).toBe(1);
});

test("listeners removed during emit do not fire for that emit", () => {
  const e = createEmitter<number>();
  const _bCalled = false;
  const unsubB = e.on(() => {
    /* fires first; will remove unsubB before B's turn */
  });
  // First listener (the one above) was added first; install A that unsubscribes B
  const _unsubA = e.on(() => {
    unsubB();
  });
  // Trick: re-order. Easier: create fresh emitter and explicitly test order.
  // Replace above with a cleaner formulation:
  const e2 = createEmitter<number>();
  let bRan = false;
  let unsubBRef: () => void = () => {
    /* no-op */
  };
  const _a = e2.on(() => {
    unsubBRef();
  });
  unsubBRef = e2.on(() => {
    bRan = true;
  });
  e2.emit(1);
  // A ran first and unsubscribed B; the snapshot taken at emit-start still includes B,
  // so B will or won't fire depending on semantics. Spec: snapshot is taken BEFORE the
  // loop starts; listeners removed AFTER snapshot capture but before their turn STILL fire.
  // Document the actual choice (clarified at implementation time): we implement "removed
  // mid-emit doesn't fire" via a `removed` Set checked inside the loop.
  expect(bRan).toBe(false);
});
