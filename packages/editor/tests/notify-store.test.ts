// The notification store as pure data — no DOM, no React (safe in bare tests/, like
// palette-store.test.ts beside it). Every rule the toast stack and the message log rest
// on is decided in this module: what survives on screen, what only reaches the log, and
// what a cap does to the overflow.
//
// The clock and the timer are INJECTED, so nothing here waits on real time and no
// assertion depends on Date.now: `advance(ms)` moves the fake clock and fires whatever
// the store scheduled inside that window.
import { expect, test } from "bun:test";
import {
  createNotifyStore,
  LOG_CAP,
  type NotifyStore,
  TOAST_CAP,
  TOAST_TTL_MS,
} from "../src/frontend/lib/notify-store.ts";

/** The store under a fake clock + fake scheduler. `pending` is how a test proves a
 *  cancelled timer is really gone rather than merely harmless. */
function makeStore(): {
  store: NotifyStore;
  advance: (ms: number) => void;
  /** Move the clock WITHOUT firing anything — a real timer between its deadline passing
   *  and its callback getting a turn, which `advance` cannot express and which is the
   *  only way to reach a zero remainder. */
  warp: (ms: number) => void;
  at: () => number;
  pending: () => number;
} {
  let clock = 1_000;
  let nextTimer = 0;
  const timers = new Map<number, { due: number; fn: () => void }>();
  const store = createNotifyStore({
    now: () => clock,
    schedule: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { due: clock + ms, fn });
      return () => {
        timers.delete(id);
      };
    },
  });
  return {
    store,
    advance: (ms) => {
      clock += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due > clock) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    warp: (ms) => {
      clock += ms;
    },
    at: () => clock,
    pending: () => timers.size,
  };
}

const toastTexts = (store: NotifyStore): string[] =>
  store.getSnapshot().toasts.map((t) => t.text);

const logTexts = (store: NotifyStore): string[] =>
  store.getSnapshot().log.map((e) => e.text);

test("error toasts persist until dismissed; info toasts expire", () => {
  const { store, advance, pending } = makeStore();

  store.info("loading cavern…");
  store.error("bake failed: disk full");
  store.success("saved 12 files");
  expect(toastTexts(store)).toEqual([
    "loading cavern…",
    "bake failed: disk full",
    "saved 12 files",
  ]);
  // The error has NO timer — the other two do. D-19: destructive persists until
  // dismissed, success fades (same TTL class as info).
  expect(pending()).toBe(2);

  advance(TOAST_TTL_MS);
  expect(toastTexts(store)).toEqual(["bake failed: disk full"]);
  // Nothing left ticking: an expired toast must not leave its timer behind.
  expect(pending()).toBe(0);

  // …and time alone never clears it. Only the dismiss does.
  advance(TOAST_TTL_MS * 10);
  expect(toastTexts(store)).toEqual(["bake failed: disk full"]);

  const [error] = store.getSnapshot().toasts;
  if (error === undefined) throw new Error("the error toast vanished");
  store.dismiss(error.id);
  expect(toastTexts(store)).toEqual([]);
  // Dismissing takes it off the SCREEN, not out of the record.
  expect(logTexts(store)).toContain("bake failed: disk full");
});

test("a warn fades like an info and never lights the ⚠ chip", () => {
  const { store, advance, pending } = makeStore();

  const IDLE =
    "walkability advisor idle — this project installs no agent profile";
  store.warn(IDLE);
  store.warn("kit layer dropped — re-toggle to refresh");

  // The boot this severity exists for: two things worth saying, nothing wrong, and
  // NOTHING for the ⚠ chip to count. Routed as `error` — which was the only
  // non-cheerful member there was — this same pair opens the editor with a red 2 over
  // a project where the advisor is correctly idle.
  expect(store.getSnapshot().unreadErrors).toBe(0);
  expect(toastTexts(store)).toEqual([
    IDLE,
    "kit layer dropped — re-toggle to refresh",
  ]);
  // Both are on the fade clock, which is the second consequence: a warning is a report
  // on something that already settled, and reports should leave.
  expect(pending()).toBe(2);

  // An error beside them takes no timer and DOES count — the two halves of the split
  // in one snapshot, so neither assertion can pass by the store having stopped
  // counting altogether.
  store.error("bake failed: disk full");
  expect(pending()).toBe(2);
  expect(store.getSnapshot().unreadErrors).toBe(1);

  advance(TOAST_TTL_MS);
  expect(toastTexts(store)).toEqual(["bake failed: disk full"]);
  expect(pending()).toBe(0);
  // Off the screen, still in the record, still carrying the severity the log row's
  // amber tone is read back from.
  expect(store.getSnapshot().log.map((e) => e.severity)).toEqual([
    "error",
    "warn",
    "warn",
  ]);
  // …and reading them later never retro-lights the chip either.
  expect(store.getSnapshot().unreadErrors).toBe(1);
  store.markSeen();
  expect(store.getSnapshot().unreadErrors).toBe(0);
});

test("hovering holds the countdown; leaving spends only what was LEFT of it", () => {
  const { store, advance, pending } = makeStore();

  store.info("saved 12 files");
  // Half the toast's life spent reading it…
  advance(TOAST_TTL_MS / 2);
  expect(toastTexts(store)).toEqual(["saved 12 files"]);

  // …and then the pointer arrives. Nothing is counting down while it is there: an
  // auto-dismiss is a time limit on READING, which WCAG 2.2.1 asks to be extendable.
  // Asserted through `pending` as well as through the screen, so a "pause" that merely
  // re-scheduled the same TTL cannot pass this line.
  store.pause();
  expect(pending()).toBe(0);
  advance(TOAST_TTL_MS * 3);
  expect(toastTexts(store)).toEqual(["saved 12 files"]);

  // Leaving spends the REMAINDER, not a fresh TTL — the difference between an
  // accessible pause and a toast that gets longer every time it is glanced at. The
  // two-step advance is the whole assertion: one ms short of the half that was left it
  // is still there, and the next ms takes it. A resume that restarted survives both.
  store.resume();
  expect(pending()).toBe(1);
  advance(TOAST_TTL_MS / 2 - 1);
  expect(toastTexts(store)).toEqual(["saved 12 files"]);
  advance(1);
  expect(toastTexts(store)).toEqual([]);
  expect(pending()).toBe(0);
});

test("hover churn cannot compound, and an error has no countdown to hold", () => {
  const { store, advance, pending } = makeStore();
  const SPENT = 1_000;

  store.info("loading cavern…");
  store.error("bake failed: disk full");
  // Only the info is ticking. The error never took a timer at all, which is what puts
  // it outside pause/resume BY CONSTRUCTION rather than by a special case in them.
  expect(pending()).toBe(1);
  advance(SPENT);

  // Two enters, a leave/enter PAIR, then two leaves. The middle pair is not a hypothesis:
  // the column is pointer-events-none, so the gap between two rows belongs to the canvas
  // behind it and sliding down the stack fires exactly that. None of it may compound —
  // not the doubled enter, not the round trip, not the doubled leave.
  store.pause();
  store.pause();
  expect(pending()).toBe(0);
  store.resume();
  store.pause();
  expect(pending()).toBe(0);
  advance(TOAST_TTL_MS * 2);
  store.resume();
  store.resume();
  expect(pending()).toBe(1);

  advance(TOAST_TTL_MS - SPENT - 1);
  expect(toastTexts(store)).toEqual([
    "loading cavern…",
    "bake failed: disk full",
  ]);
  advance(1);
  // What was left when the pointer arrived is exactly what it spent — no more from the
  // doubled pause, no second timer from the doubled resume…
  expect(toastTexts(store)).toEqual(["bake failed: disk full"]);
  // …and the error sat through all four calls untouched.
  expect(pending()).toBe(0);
});

test("holding the stack notifies nobody — nothing on screen changed", () => {
  const { store } = makeStore();
  store.info("saved 12 files");

  let notified = 0;
  store.subscribe(() => {
    notified++;
  });
  const before = store.getSnapshot();

  store.pause();
  store.resume();
  store.pause();
  // The snapshot is what useSyncExternalStore compares BY IDENTITY, so an emit per
  // crossing would hand all three subscribers (the toast stack, the ⚠ chip, the log
  // palette) a NEW object describing the very same screen every time the pointer moves
  // over the stack — and the pause/resume pair around a dismiss makes that per keypress.
  expect(notified).toBe(0);
  expect(store.getSnapshot()).toBe(before);
});

test("a toast that arrives while the stack is held still leaves on its own", () => {
  const { store, advance, pending } = makeStore();

  store.info("loading cavern…");
  store.pause();
  store.info("saved 12 files");
  // The new one takes its full timer AT PUSH rather than joining the hold. A store-level
  // "paused" mode would do the opposite, and could strand it: the stack can unmount from
  // under the pointer (its last toast dismissed) with no mouseleave to follow, and every
  // later message would then sit on screen forever waiting for a resume nothing sends.
  expect(pending()).toBe(1);

  advance(TOAST_TTL_MS);
  expect(toastTexts(store)).toEqual(["loading cavern…"]);
  expect(pending()).toBe(0);
});

test("clearing takes the held bookkeeping with it", () => {
  const { store, pending, warp } = makeStore();

  store.info("loading cavern…");
  store.pause();
  store.clear();
  // A resume arriving AFTER the clear — the pointer leaving a stack the log palette's
  // Clear verb just emptied — must revive nothing. Emptying the map is what makes that
  // true; cancelling only the running timers would leave the held entries behind.
  store.resume();
  expect(pending()).toBe(0);
  expect(toastTexts(store)).toEqual([]);

  // …and the store still works afterwards, on a full TTL rather than some remembered
  // remainder: the clear took the bookkeeping, not the capability.
  store.info("saved 12 files");
  warp(TOAST_TTL_MS - 1);
  expect(toastTexts(store)).toEqual(["saved 12 files"]);
});

test("a pause landing ON the deadline still leaves the removal to a turn", () => {
  const { store, advance, warp, pending } = makeStore();

  store.info("saved 12 files");
  // The deadline passes with the callback still queued — `warp` is exactly that state,
  // and it is reachable for real: a mouseenter can be handled in a task that starts
  // after the deadline but before the timer gets its turn, and a backward wall-clock
  // step lands in the same place. `remaining` is 0, the one input where "schedule a 0 ms
  // timer" and "remove it now" come apart.
  warp(TOAST_TTL_MS);
  store.pause();
  expect(pending()).toBe(0);

  store.resume();
  // STILL UP. Removing inline would make `resume` — a thing called straight from a React
  // mouseleave — a mutation that emits, and would cost the property that a toast only
  // ever leaves the screen on a scheduler turn.
  expect(toastTexts(store)).toEqual(["saved 12 files"]);
  expect(pending()).toBe(1);

  advance(0);
  expect(toastTexts(store)).toEqual([]);
  expect(pending()).toBe(0);
});

test("the visible stack caps at 3; overflow increments the log-only counter", () => {
  const { store, advance } = makeStore();

  for (const text of ["one", "two", "three", "four", "five"]) store.info(text);

  // The first TOAST_CAP hold the screen; the rest are log-only. Dropping the OLDEST
  // instead would let a flood of infos silently evict an undismissed error, which is
  // the one thing D-19 says must never disappear on its own.
  expect(TOAST_CAP).toBe(3);
  expect(toastTexts(store)).toEqual(["one", "two", "three"]);
  expect(store.getSnapshot().overflow).toBe(2);
  expect(logTexts(store)).toEqual(["five", "four", "three", "two", "one"]);

  // A freed slot does NOT promote an overflowed message: it is old news by then, and
  // a toast that appears seconds after its moment reads as a new event.
  advance(TOAST_TTL_MS);
  expect(toastTexts(store)).toEqual([]);
  expect(store.getSnapshot().overflow).toBe(2);

  // …and the counter keeps counting only what the screen refused.
  store.info("six");
  expect(toastTexts(store)).toEqual(["six"]);
  expect(store.getSnapshot().overflow).toBe(2);
  // DERIVED from the surviving entries (each message records whether it ever held a
  // slot), never accumulated — see the ring case for what a running total does.
  expect(store.getSnapshot().log.filter((e) => !e.toasted).length).toBe(2);
});

test("every toast also lands in the log with severity + timestamp", () => {
  const { store, advance, at } = makeStore();

  const firstAt = at();
  store.info("new world — all solid rock");
  // Inside the info TTL, so both are still on screen when the ids are compared below.
  advance(TOAST_TTL_MS - 1_000);
  const secondAt = at();
  store.error("selection found no matching cells");

  // Newest first — the order the log palette reads.
  const [newest, oldest, ...rest] = store.getSnapshot().log;
  expect(rest).toEqual([]);
  expect(newest).toMatchObject({
    severity: "error",
    text: "selection found no matching cells",
    at: secondAt,
  });
  expect(oldest).toMatchObject({
    severity: "info",
    text: "new world — all solid rock",
    at: firstAt,
  });
  // The log entry and its toast are the SAME record, so a dismiss can name one id.
  expect(store.getSnapshot().toasts.map((t) => t.id)).toEqual([
    oldest?.id ?? -1,
    newest?.id ?? -1,
  ]);
  expect(store.getSnapshot().unreadErrors).toBe(1);
});

test("log is a ring buffer capped at 200", () => {
  const { store } = makeStore();

  for (let i = 0; i < LOG_CAP + 5; i++) store.info(`m${i}`);

  const log = store.getSnapshot().log;
  expect(LOG_CAP).toBe(200);
  expect(log.length).toBe(LOG_CAP);
  // The newest survive and the oldest fall off the end — a log that dropped the NEW
  // ones instead would go blind exactly when something is going wrong repeatedly.
  expect(log[0]?.text).toBe(`m${LOG_CAP + 4}`);
  expect(log.at(-1)?.text).toBe("m5");
  expect(log.some((e) => e.text === "m0")).toBe(false);

  // The overflow count is about THESE entries, so it can never exceed them. 205 pushes
  // with a running counter would say "200 messages · 202 not shown as toasts" — two
  // numbers about one list that cannot both be true, and the header renders both.
  expect(store.getSnapshot().overflow).toBeLessThanOrEqual(log.length);
  expect(store.getSnapshot().overflow).toBe(LOG_CAP);
});

test("the snapshot is a stable reference between mutations (useSyncExternalStore)", () => {
  const { store, advance } = makeStore();
  let notified = 0;
  const unsubscribe = store.subscribe(() => {
    notified++;
  });

  const before = store.getSnapshot();
  expect(store.getSnapshot()).toBe(before);

  store.info("saving…");
  expect(notified).toBe(1);
  const afterPush = store.getSnapshot();
  expect(afterPush).not.toBe(before);
  expect(store.getSnapshot()).toBe(afterPush);

  // An EXPIRY is a mutation too — a cached snapshot that survived it would leave a
  // faded toast on screen forever (React re-renders only when the reference changes).
  advance(TOAST_TTL_MS);
  expect(notified).toBe(2);
  expect(store.getSnapshot()).not.toBe(afterPush);

  unsubscribe();
  store.error("nobody is listening");
  expect(notified).toBe(2);
});

test("unread errors light the chip until the log is seen; clear empties everything", () => {
  const { store, pending } = makeStore();

  store.info("materials: 2 classes");
  store.error("void-cast budget exceeded");
  store.error("selection found no matching cells");
  expect(store.getSnapshot().unreadErrors).toBe(2);
  // Only errors count: an info the user never read is not a reason to light a warning.
  store.markSeen();
  expect(store.getSnapshot().unreadErrors).toBe(0);
  store.error("that flag was re-analyzed away");
  expect(store.getSnapshot().unreadErrors).toBe(1);

  // A second markSeen with nothing new must NOT notify — the log palette marks on
  // every render while it is open, and a notify per render is an infinite loop.
  let notified = 0;
  store.subscribe(() => {
    notified++;
  });
  store.markSeen();
  store.markSeen();
  expect(notified).toBe(1);

  store.info("still ticking");
  expect(pending()).toBe(1);
  store.clear();
  expect(store.getSnapshot()).toMatchObject({
    toasts: [],
    log: [],
    overflow: 0,
    unreadErrors: 0,
  });
  // Clearing cancels what was scheduled: a surviving timer would fire into an empty
  // store and notify every subscriber for nothing.
  expect(pending()).toBe(0);
});
