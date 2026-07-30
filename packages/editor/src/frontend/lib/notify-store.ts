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

/** How a message reads, and whether it leaves on its own. */
export type NotifySeverity = "info" | "success" | "error";

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
   *  clears is a badge people learn to ignore. */
  readonly unreadErrors: number;
};

export type NotifyStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): NotifySnapshot;
  info(text: string): void;
  success(text: string): void;
  error(text: string): void;
  /** Take one toast off the screen. It stays in the log. */
  dismiss(id: number): void;
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
 *  the toast rather than the severity: success fades on the same clock as info, and only
 *  errors are exempt. */
export const TOAST_TTL_MS = 4000;

const EMPTY: NotifySnapshot = {
  toasts: [],
  log: [],
  overflow: 0,
  unreadErrors: 0,
};

export function createNotifyStore(deps: NotifyDeps): NotifyStore {
  const listeners = new Set<() => void>();
  /** Cancellers for the toasts still counting down, by message id. */
  const timers = new Map<number, () => void>();
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
    const cancel = timers.get(id);
    if (!cancel) return;
    timers.delete(id);
    cancel();
  };

  const removeToast = (id: number): void => {
    clearTimer(id);
    if (!toasts.some((t) => t.id === id)) return;
    toasts = toasts.filter((t) => t.id !== id);
    emit();
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
      // else is a report on something that already finished, and reports should leave.
      if (severity !== "error")
        timers.set(
          message.id,
          deps.schedule(() => removeToast(message.id), TOAST_TTL_MS),
        );
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
    error: (text) => push("error", text),
    dismiss: removeToast,
    markSeen: () => {
      const newest = log[0]?.id ?? seenId;
      if (newest === seenId) return;
      seenId = newest;
      emit();
    },
    clear: () => {
      for (const cancel of timers.values()) cancel();
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
