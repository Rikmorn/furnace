import { describe, expect, spyOn, test } from "bun:test";
import { createViewChannel } from "../../src/viewport-host/view-channel";

describe("createViewChannel", () => {
  test("multicasts one publish to every subscriber, in subscribe order", () => {
    const channel = createViewChannel<[string]>();
    const seen: string[] = [];
    channel.subscribe((v) => seen.push(`a:${v}`));
    channel.subscribe((v) => seen.push(`b:${v}`));

    channel.publish("x");

    expect(seen).toEqual(["a:x", "b:x"]);
  });

  test("with a snapshot, subscribe pushes the current state synchronously", () => {
    let state = "first";
    const channel = createViewChannel<[string]>({ snapshot: () => [state] });
    const seen: string[] = [];

    channel.subscribe((v) => seen.push(v));
    // Synchronously INSIDE subscribe — a surface mounting mid-state must not
    // render empty beside visible overlays, so nothing may be deferred here.
    expect(seen).toEqual(["first"]);

    // The snapshot is re-read per subscribe, not captured once at construction:
    // a late mount gets the state as it is NOW.
    state = "second";
    channel.subscribe((v) => seen.push(v));
    expect(seen).toEqual(["first", "second"]);
  });

  test("without a snapshot, a subscriber hears nothing until the first publish", () => {
    const channel = createViewChannel<[string]>();
    const seen: string[] = [];

    channel.subscribe((v) => seen.push(v));
    expect(seen).toEqual([]);

    channel.publish("event");
    expect(seen).toEqual(["event"]);
  });

  test("unsubscribe removes only its own callback (the React re-run hazard)", () => {
    const channel = createViewChannel<[string]>();
    const seen: string[] = [];
    // React's effect re-run order: the NEW effect body subscribes BEFORE the
    // previous cleanup runs. A single-slot seam loses the new subscriber when
    // the stale cleanup fires; identity-keyed removal cannot.
    const stale = channel.subscribe((v) => seen.push(`stale:${v}`));
    const fresh = channel.subscribe((v) => seen.push(`fresh:${v}`));

    stale();

    channel.publish("after");
    expect(seen).toEqual(["fresh:after"]);
    expect(channel.size()).toBe(1);

    // Idempotent: a double cleanup must not take the live one with it.
    stale();
    expect(channel.size()).toBe(1);

    fresh();
    channel.publish("silent");
    expect(seen).toEqual(["fresh:after"]);
  });

  test("a throwing subscriber is reported and does not sever its siblings", () => {
    // Silenced, not just observed: isolation's whole point is that it LOGS, and a
    // suite that prints two real stack traces per green run teaches its reader to
    // scroll past exactly the output that matters when something breaks.
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const channel = createViewChannel<[string]>();
      const seen: string[] = [];
      channel.subscribe(() => {
        throw new Error("subscriber blew up");
      });
      channel.subscribe((v) => seen.push(`after:${v}`));

      // publish() itself must not throw — a chrome surface's bug cannot become
      // the host's refusal.
      expect(() => channel.publish("x")).not.toThrow();
      // ...and the subscriber BEHIND the thrower still got its delivery.
      expect(seen).toEqual(["after:x"]);
      expect(errors).toHaveBeenCalledTimes(1);

      // The thrower stays subscribed: isolation reports, it does not evict.
      channel.publish("y");
      expect(seen).toEqual(["after:x", "after:y"]);
      expect(errors).toHaveBeenCalledTimes(2);
    } finally {
      errors.mockRestore();
    }
  });

  test("a snapshot push that throws is isolated too", () => {
    // Silenced, not just observed: isolation's whole point is that it LOGS, and a
    // suite that prints two real stack traces per green run teaches its reader to
    // scroll past exactly the output that matters when something breaks.
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const channel = createViewChannel<[string]>({ snapshot: () => ["now"] });
      expect(() =>
        channel.subscribe(() => {
          throw new Error("mount blew up");
        }),
      ).not.toThrow();
      expect(errors).toHaveBeenCalledTimes(1);
      // It is still subscribed — subscribe returned normally, so the caller
      // holds a real unsubscribe and the count must agree with that.
      expect(channel.size()).toBe(1);
    } finally {
      errors.mockRestore();
    }
  });

  test("(un)subscribing mid-publish does not corrupt the in-flight pass", () => {
    const channel = createViewChannel<[string]>();
    const seen: string[] = [];
    const late = (v: string): void => {
      seen.push(`late:${v}`);
    };

    let dropC: (() => void) | null = null;
    channel.subscribe((v) => {
      seen.push(`a:${v}`);
      // Both mutations land mid-pass, from inside the first delivery.
      dropC?.();
      channel.subscribe(late);
    });
    channel.subscribe((v) => seen.push(`b:${v}`));
    dropC = channel.subscribe((v) => seen.push(`c:${v}`));

    channel.publish("1");

    // The pass runs over the membership as it stood at publish time: c is still
    // delivered though it was dropped mid-pass, and `late` — added mid-pass —
    // is not. Anything else and a subscriber's own bookkeeping could silently
    // skip a sibling in the same pass.
    expect(seen).toEqual(["a:1", "b:1", "c:1"]);

    seen.length = 0;
    dropC = null;
    channel.publish("2");
    // The NEXT pass sees the mutations: c gone, `late` present. `a` subscribes
    // another `late` here, but `late` is the same function reference, so the
    // Set holds one entry (see the TSDoc's identity note).
    expect(seen).toEqual(["a:2", "b:2", "late:2"]);
  });

  test("size() reports live subscribers", () => {
    const channel = createViewChannel<[string]>();
    expect(channel.size()).toBe(0);

    const first = channel.subscribe(() => undefined);
    const second = channel.subscribe(() => undefined);
    expect(channel.size()).toBe(2);

    first();
    expect(channel.size()).toBe(1);
    second();
    expect(channel.size()).toBe(0);
  });

  test("a zero-arg channel carries no payload (the subscribeEntities shape)", () => {
    // Task 4 migrates `subscribeEntities(cb: () => void)` onto this, so `<[]>`
    // has to be a real, callable instantiation — not just one that compiles.
    const channel = createViewChannel<[]>();
    let ticks = 0;
    channel.subscribe(() => {
      ticks++;
    });

    channel.publish();
    channel.publish();

    expect(ticks).toBe(2);
  });

  test("a zero-arg channel can still push on subscribe", () => {
    const channel = createViewChannel<[]>({ snapshot: () => [] });
    let ticks = 0;

    channel.subscribe(() => {
      ticks++;
    });

    expect(ticks).toBe(1);
  });
});
