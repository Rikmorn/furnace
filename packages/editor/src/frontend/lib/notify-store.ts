// What the editor SAYS: a capped toast stack over a durable message log (D-19).
//
// FRAMEWORK-FREE on purpose — subscribe/getSnapshot is the `useSyncExternalStore`
// contract and nothing more, so every rule below (what persists, what fades, what the
// cap does to the surplus) is decided in one place that a bare test can drive without a
// DOM, a clock, or a React tree.
//
// Two seams are INJECTED rather than reached for: the clock and the timer. A store that
// called Date.now/setTimeout itself could only be tested by waiting, which is how a TTL
// suite becomes both slow and flaky. `notify` — the singleton the chrome imports — wires
// the browser ones; a test wires fakes and moves time by hand.

/** How a message reads, and whether it leaves on its own.
 *
 *  `error` is the only member that behaves differently from the other three: it holds
 *  the screen until dismissed and it is the only one the ⚠ chip counts. `warn` is
 *  deliberately on the fading, uncounted side — a warning says something worth reading
 *  about a state that is not wrong (the advisor idle over a project that installs no
 *  agent profile), and routing that through `error` is what opened the editor with a
 *  red badge on a clean boot. */
export type NotifySeverity = "info" | "success" | "warn" | "error";

/** One message. The toast and its log entry are the SAME record (same `id`), which is
 *  what lets a dismiss name one thing and what keeps the two views from disagreeing. */
export type NotifyMessage = {
  readonly id: number;
  readonly severity: NotifySeverity;
  readonly text: string;
  /** Wall-clock ms from the injected clock — the log renders relative time off it. */
  readonly at: number;
  /** Whether this message ever held a toast slot. Decided once, at push: it is the
   *  difference between "you saw this go by" and "this only ever existed in the log",
   *  and recording it ON the message is what keeps the overflow count bounded by the
   *  log that is showing it (see `NotifySnapshot.overflow`). */
  readonly toasted: boolean;
};

export type NotifySnapshot = {
  /** The visible stack, OLDEST FIRST (it grows downward on screen), ≤ TOAST_CAP. */
  readonly toasts: readonly NotifyMessage[];
  /** The durable log, NEWEST FIRST — the order the log palette reads. ≤ LOG_CAP. */
  readonly log: readonly NotifyMessage[];
  /** How many of the messages IN `log` never got a visible slot — so the log can say
   *  it is holding things the user never saw. Derived from the surviving entries
   *  rather than accumulated: a running counter would eventually read "200 messages ·
   *  997 not shown as toasts", two numbers about the same list that cannot both be
   *  true. This one is bounded by `log.length` by construction. */
  readonly overflow: number;
  /** Errors logged since the last `markSeen`. The ⚠ chip's count: a badge that never
   *  clears is a badge people learn to ignore. `error` ONLY — a warning that lit this
   *  would demand attention exactly the way the severity exists not to. */
  readonly unreadErrors: number;
};

export type NotifyStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): NotifySnapshot;
  info(text: string): void;
  success(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  /** Take one toast off the screen. It stays in the log. */
  dismiss(id: number): void;
  /** Hold every counting-down toast where it is: the pointer or the keyboard is IN the
   *  stack, so someone is reading. An auto-dismiss is a time limit on reading and WCAG
   *  2.2.1 asks for a way to extend one; pause-on-hover is that way.
   *
   *  Idempotent, and deliberately silent — it changes nothing that is on screen, so it
   *  must not notify (see the implementation for what an emit per crossing would cost). */
  pause(): void;
  /** Let the held toasts spend what is LEFT of their TTL. Not a fresh one: three
   *  seconds spent reading a four-second toast must leave one second, not four. */
  resume(): void;
  /** Mark everything currently logged as read (the log palette calls this while it is
   *  on screen). A no-op when nothing is new — it must not notify, or a palette that
   *  marks on render would loop. */
  markSeen(): void;
  /** Forget everything: toasts, log, overflow, unread. The log palette's Clear verb. */
  clear(): void;
};

/** The clock and the timer, so tests own both. `schedule` returns its own canceller
 *  rather than a handle, which keeps the timer type out of this module (browser
 *  `setTimeout` returns a number, Node's returns an object). */
export type NotifyDeps = {
  now: () => number;
  /** MUST NOT invoke `fn` synchronously. `resume` can hand it a 0 ms delay, and a
   *  same-turn callback would remove the toast BEFORE `startTimer` records the entry —
   *  stranding a dead id in `timers` for the life of the session. Every implementation
   *  we wire (real `setTimeout`, the tests' fake clock) defers, which is the property
   *  this line exists to keep true. */
  schedule: (fn: () => void, ms: number) => () => void;
};

/** How many toasts may hold the screen at once. Three is the mock's stack and about as
 *  many as anyone reads before they blur into a wall. */
export const TOAST_CAP = 3;

/** How many messages the log keeps. 200 is a long working session's worth of saves,
 *  bakes and refusals — enough to answer "what did I just do", bounded so a chatty
 *  session cannot grow the tab's memory without limit. */
export const LOG_CAP = 200;

/** How long a toast that leaves ON ITS OWN holds the screen. Long enough to read a
 *  sentence, short enough that a save + a bake do not stack up on each other. Named for
 *  the toast rather than the severity: success and warn fade on the same clock as info,
 *  and errors are the one exemption.
 *
 *  A budget of UNATTENDED time rather than wall clock: `pause`/`resume` hold the
 *  countdown while the pointer or the keyboard is in the stack, so a toast under the
 *  reader's cursor never spends it. */
export const TOAST_TTL_MS = 4000;

/** One toast's countdown. RUNNING carries the canceller and the clock reading it is due
 *  to leave at; PAUSED carries only what is LEFT of its TTL — which is the whole reason
 *  the deadline is recorded at all, since a pause has to be able to answer "how much was
 *  spent" without asking the timer it just cancelled. */
type ToastTimer =
  | {
      readonly state: "running";
      readonly cancel: () => void;
      readonly due: number;
    }
  | { readonly state: "paused"; readonly remaining: number };

const EMPTY: NotifySnapshot = {
  toasts: [],
  log: [],
  overflow: 0,
  unreadErrors: 0,
};

export function createNotifyStore(deps: NotifyDeps): NotifyStore {
  const listeners = new Set<() => void>();
  /** The toasts still counting down — or held mid-count — by message id. An `error`
   *  never appears here, because `push` gives it no timer at all: that is what keeps it
   *  outside pause/resume by construction rather than by a special case inside them. */
  const timers = new Map<number, ToastTimer>();
  let toasts: readonly NotifyMessage[] = [];
  let log: readonly NotifyMessage[] = [];
  /** The newest id the user has seen in the log; -1 = nothing seen yet. */
  let seenId = -1;
  let nextId = 0;
  // The cached snapshot, invalidated by every mutation. useSyncExternalStore compares
  // getSnapshot's RESULT by identity and re-renders when it changes — rebuilding the
  // object per call would re-render every consumer on every render, forever.
  let snapshot: NotifySnapshot | null = EMPTY;

  const emit = (): void => {
    snapshot = null;
    for (const listener of listeners) listener();
  };

  const clearTimer = (id: number): void => {
    const timer = timers.get(id);
    if (!timer) return;
    timers.delete(id);
    if (timer.state === "running") timer.cancel();
  };

  const removeToast = (id: number): void => {
    clearTimer(id);
    if (!toasts.some((t) => t.id === id)) return;
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  };

  /** Start one toast's countdown over `ms`, recording the deadline a later pause reads
   *  the remainder off. Used by `push` for a full TTL and by `resume` for the rest. */
  const startTimer = (id: number, ms: number): void => {
    timers.set(id, {
      state: "running",
      due: deps.now() + ms,
      cancel: deps.schedule(() => removeToast(id), ms),
    });
  };

  const push = (severity: NotifySeverity, text: string): void => {
    // A full stack makes this message log-only. The surplus does NOT evict the oldest
    // toast: an undismissed error would be exactly what a flood of infos pushed off
    // the screen, and D-19's whole point is that an error cannot vanish on its own.
    const toasted = toasts.length < TOAST_CAP;
    const message: NotifyMessage = {
      id: nextId++,
      severity,
      text,
      at: deps.now(),
      toasted,
    };
    log = [message, ...log].slice(0, LOG_CAP);
    if (toasted) {
      toasts = [...toasts, message];
      // Errors are the exception: they stay until the user takes them away. Everything
      // else — a WARNING included — is a report on something that already settled, and
      // reports should leave. A warning that had to be dismissed would be a second
      // demand for attention over a state nobody has to act on.
      //
      // A message that arrives while the stack is HELD still takes its full timer here
      // rather than joining the hold — see `pause` for why nothing waits on a resume.
      if (severity !== "error") startTimer(message.id, TOAST_TTL_MS);
    }
    emit();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => {
      if (snapshot === null)
        snapshot = {
          toasts,
          log,
          overflow: log.filter((e) => !e.toasted).length,
          unreadErrors: log.filter(
            (e) => e.id > seenId && e.severity === "error",
          ).length,
        };
      return snapshot;
    },
    info: (text) => push("info", text),
    success: (text) => push("success", text),
    warn: (text) => push("warn", text),
    error: (text) => push("error", text),
    dismiss: removeToast,
    pause: () => {
      // Held ON THE TIMERS rather than in a store-level "paused" mode, and that is the
      // load-bearing choice. A mode flag can go stale — the stack unmounts from under
      // the pointer when its last toast is dismissed and no mouseleave ever follows —
      // and would then hold every LATER message on screen forever. State that lives on
      // the timers can only ever affect toasts that are already up, and those take
      // their entry with them when they are dismissed, expire, or are cleared.
      //
      // Idempotent for free: a second enter finds nothing RUNNING, so it cannot compound
      // (the pointer crossing between two rows, and the resume/pause pair a dismiss fires
      // as focus leaves the removed × and lands on its neighbour, both land here).
      //
      // It does NOT emit: the visible stack is unchanged, and `getSnapshot`'s identity is
      // what useSyncExternalStore compares — an emit per crossing would re-render all
      // three subscribers (this stack, the ⚠ chip, the log palette) over an identical
      // screen. Same reasoning as `markSeen`'s no-op guard.
      const at = deps.now();
      for (const [id, timer] of timers) {
        if (timer.state !== "running") continue;
        timer.cancel();
        // Floored at zero: `schedule` is never handed a negative delay, however the
        // clock behaved between the deadline and the pause.
        timers.set(id, {
          state: "paused",
          remaining: Math.max(0, timer.due - at),
        });
      }
    },
    resume: () => {
      // Only what a pause actually held: a toast pushed while the stack was hovered is
      // already RUNNING on its own full TTL and is skipped. Also silent, and for the
      // same reason — nothing on screen moved.
      for (const [id, timer] of timers)
        if (timer.state === "paused") startTimer(id, timer.remaining);
    },
    markSeen: () => {
      const newest = log[0]?.id ?? seenId;
      if (newest === seenId) return;
      seenId = newest;
      emit();
    },
    clear: () => {
      // Only the running ones hold a real timer; emptying the map is what takes the HELD
      // bookkeeping away too, so a resume that arrives after a clear (the pointer leaving
      // a stack this verb just emptied) revives nothing.
      for (const timer of timers.values())
        if (timer.state === "running") timer.cancel();
      timers.clear();
      toasts = [];
      log = [];
      seenId = -1;
      emit();
    },
  };
}

/** The one store the chrome talks to. Browser deps: the real clock, the real timer. */
export const notify: NotifyStore = createNotifyStore({
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
});
