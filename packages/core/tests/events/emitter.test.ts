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
  let bRan = false;
  let unsubB: () => void = () => {
    /* no-op */
  };
  e.on(() => {
    unsubB();
  });
  unsubB = e.on(() => {
    bRan = true;
  });
  e.emit(1);
  // A unsubscribes B before B's turn; with removed-set semantics, B must not fire.
  expect(bRan).toBe(false);
});

test("subscriber throws don't break other subscribers; error is logged", () => {
  const e = createEmitter<number>();
  const originalError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    let receivedA = 0;
    let receivedC = 0;
    e.on(() => {
      receivedA++;
    });
    e.on(() => {
      throw new Error("boom");
    });
    e.on(() => {
      receivedC++;
    });

    expect(() => e.emit(1)).not.toThrow();

    expect(receivedA).toBe(1);
    expect(receivedC).toBe(1);
    expect(errors.length).toBe(1);
    // The emitter passes the raw Error object as the second arg so
    // console.error gets the full pretty-printing / stack treatment.
    const args = errors[0];
    if (!args) throw new Error("unreachable: errors.length checked above");
    expect(args[0]).toBe("[furnace/events] subscriber threw:");
    expect(args[1]).toBeInstanceOf(Error);
    expect((args[1] as Error).message).toBe("boom");
  } finally {
    console.error = originalError;
  }
});
