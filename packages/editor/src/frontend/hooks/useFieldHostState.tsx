// How the chrome reads the host: ONE latch per consumer, over seams that are multicast.
//
// Every FieldHost subscribe seam is MULTICAST (T3a: `viewport-host/view-channel.ts`) — N
// subscribers each get every push, an unsubscribe removes only its own callback, and a
// throwing subscriber is logged rather than severing its siblings. That is what this file
// is built on now. It used to be built on the opposite: a single-slot seam, where a second
// subscriber STOLE the first's callback, so the subscriptions had to live in one place and
// fan their values out through ten React contexts.
//
// The fan-out is gone. Each `useField*` hook below subscribes to the seam it reads, in the
// component that reads it, through `useSeam` — a `useSyncExternalStore` latch. Two
// consequences are worth stating because they invert what the old header said:
//
//   - CADENCE ISOLATION IS FINER, not coarser. The old split put the frame-paced seams
//     (stats, camera pose) in their own contexts so a fly-around would not re-render the
//     entities palette. A per-consumer latch does that by construction and one step
//     further: a surface that does not call the hook does not subscribe at all, so an
//     unmounted palette costs nothing and a mounted one pays only for what it reads.
//   - A DUPLICATE SUBSCRIPTION IS NO LONGER A BUG. Two mirrors of one seam is the normal
//     arrangement now (the status bar and the action registry both read the tool). What
//     still IS a bug is a mirror that never releases, and that is what the counts in
//     `tests/chrome/host-seams-and-catalogs.test.tsx` pin: mount a surface, unmount it,
//     and the seam must go back to the subscriber count it had.
//
// ALL THIRTEEN seams are still read here — each one's job is stated where it is wired, at
// its `latch*` below. TEN are per-consumer latches. THREE stay in the provider shell,
// because each feeds state the CHROME owns rather than state the host pushes:
// `subscribeTool` (the tool + radius cells), `subscribeToolError` (the toast, which is no
// one surface's) and `subscribeFlags` (the findings, and a verify release that has to keep
// working while the palette showing it is closed). Their effects say why in full.
//
// THE ONE CONTEXT, and why the chrome-owned state is not IN it. `FieldShellContext` carries
// `{ host, engineReady, chrome }` and its value changes only when the host arrives or the
// engine comes up — twice in a session. That stability is load-bearing: every hook here
// reads this context, so a value that moved with the brush radius would re-render the
// entities palette on every slider frame, which is precisely the cost the old cadence split
// existed to avoid. So the SIX chrome-owned values live in CELLS on `chrome` (see
// `createCell`) and are latched by the same `useSeam` the host seams are: shared truth,
// per-consumer subscription.
//
// FIVE of the six are FORCED and one is a judgement call, and keeping that straight
// matters more than a round number:
//
//   - `tool` + `radius` ride `subscribeTool`, an EVENT channel with NO snapshot
//     (field-host.ts) — and `TopBar` swaps `ToolStrip` out for a `SessionStrip` for the
//     whole of every stamp session. So a latch would remount reading `DEFAULT_TOOL` /
//     `DEFAULT_RADIUS` beside a brush the viewport is actively drawing, and nothing would
//     ever correct it: an event seam has no catch-up push. `tool` is forced twice over —
//     the plain `FieldHost.setTool` publishes nothing at all, so its three simultaneous
//     readers would diverge permanently the first time anyone picked a brush.
//     (Both values DO come back on that seam from the host's own paths — the eyedrop, the
//     momentary ⇧/⌃, the wheel, `[` / `]`. Being pushed back was never the question; being
//     pushed back TO A LATE MOUNT is, and that is what the missing snapshot decides.)
//   - `gesture` has no seam in either direction, so there is nothing to reconcile copies
//     against at all.
//   - `filters` + `verifying` have to outlive the surface that shows them: `PaletteLayer`
//     unmounts a closed palette's body, and per-consumer state would lose the user's bands
//     to a debounce its own unmount cancelled and drop a verify the host is still running.
//   - `flags` is the CHOSEN one. `flagsChannel` does carry a snapshot, so a latch would
//     work; it is a cell because its push and the `verifying` release are one coupling and
//     one effect, and splitting them would be two subscriptions to say one thing.
//
// The PURE half of this mirror — the value-equality comparators, the literals the cells
// open at, and the filter restore — lives in `../lib/field-host-mirrors.ts`, where each is
// directly unit-testable. Nothing with React in it went with them, and
// `PERSIST_DEBOUNCE_MS` below stays because it tunes an EFFECT here rather than describing
// a mirrored value.
import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type {
	CameraPose,
	FieldDriftReport,
	FieldEntityInfo,
	FieldHistory,
	FieldHost,
	FieldStats,
	FieldTool,
	FlagFilters,
	FlagsSummary,
	PendingStamp,
	SegmentHud,
	SelectionInfo,
	StampSession,
	ViewportGesture,
} from "../../viewport-host/index.ts"; // type-only: erased
import {
	DEFAULT_FLAG_FILTERS,
	DEFAULT_GESTURE,
	DEFAULT_RADIUS,
	DEFAULT_TOOL,
	deserializeFilters,
	NO_FLAGS,
	NO_HISTORY,
	sameEntities,
	statsEqual,
	toolsEqual,
} from "../lib/field-host-mirrors.ts";
import { notify } from "../lib/notify-store.ts";
import type { UiStore } from "../lib/persist.ts";

/** Long enough that a run of chip clicks writes once when it settles rather than once
 *  per click (every `UiStore.get` re-parses the whole blob) — useView's figure, and
 *  this is a slower control than its slider. */
const PERSIST_DEBOUNCE_MS = 200;

/** Host-pushed state the shell renders. `stats` is null until the host's first push
 *  (which only starts once the render loop runs, i.e. after `init`). */
export type FieldHostState = {
	stats: FieldStats | null;
};

/** The committed generator entities plus the last reconfigure's drift report — one
 *  hook because they are one concern (what has been stamped, and what the last
 *  re-stamp disturbed) read by one surface, the entities palette. */
export type FieldEntitiesState = {
	entities: readonly FieldEntityInfo[];
	/** null = clean / none. The report is HOST state: dismiss goes through the host.
	 *  Carries its own `entityIds` — see `driftedIds`. */
	drift: FieldDriftReport | null;
	/** The rows that wear a drift badge, as a set for the row-by-row lookup that
	 *  reads it. The MEMBERSHIP is the host's answer (it owns both the findings'
	 *  chunk keys and the footprints, and the chrome cannot value-import core to
	 *  quantize either) — all that happens here is array → Set. */
	driftedIds: ReadonlySet<number>;
};

/** The armed brush, what LMB is armed to do, and the radius it strokes with. Read-write
 *  in one shape rather than the state/actions PAIR the sibling providers use (useView,
 *  useWorkspace, useWorld): the adopt and the push here are ONE concern that cannot be
 *  separated — see the echo guard on the tool mirror — and useView's own header says to
 *  delete that split rather than defend it where nobody benefits. Every consumer of this
 *  hook both shows the tool and changes it. */
export type FieldToolState = {
	tool: FieldTool;
	/** What LMB is armed to do — `null` = the brush strokes. CHROME state pushed one way
	 *  into the host — and the only one of the five that is one-way: `setGesture` has no
	 *  subscription behind it (nor anything riding another seam, which is where `radius`
	 *  went at the F4.5 gate), so this is a MIRROR by construction rather than by echo, and
	 *  it opens at `"pointer"` because that is what a fresh host is already armed with
	 *  (D-F4.5-7).
	 *
	 *  Several surfaces write it — the tool rail's family buttons and member flyouts, the
	 *  action registry's `V`/`B`/`M` family keys, and `armBrush` — while the status bar's
	 *  keymap line reads it. With no seam behind it there is nothing to reconcile a
	 *  per-surface copy against, so a key arming something a button was showing would
	 *  simply leave the two disagreeing. */
	gesture: ViewportGesture | null;
	/** The brush radius — a MIRROR since the F4.5 gate's W-2, not chrome-only state.
	 *  `FieldTool` still does not carry it (the momentary overrides are why — see
	 *  `FieldToolPush`), but the tool seam pushes it alongside, so the wheel and `[` / `]`
	 *  reach this value now. See `setRadius` for the two-way contract. */
	radius: number;
	/** The stamp ARMED for region-draw — `null` = none (D-F4.5-7). Unlike `gesture` this
	 *  is HOST state with a real seam behind it (`subscribePendingStamp`): the host
	 *  decides whether picking a stamp opens a session or asks for a region, and it also
	 *  clears the arm from paths the chrome never sees (the canvas's own Esc, the region
	 *  landing). Read-only here for that reason — `host.startStamp` is what sets it, and
	 *  the seam is what carries it back, so this one IS a per-consumer latch. */
	pendingStamp: PendingStamp | null;
	/** Arm what LMB does — adopt + push, the ONE funnel, exactly as `setTool` is. */
	setGesture: (next: ViewportGesture | null) => void;
	/** Adopt + push, the ONE funnel for a tool change. The host clamps (smooth ceilings,
	 *  hollow floor) as a backstop; the controls stay inside the same ranges so chrome
	 *  and host agree.
	 *
	 *  The adopt is not an optimisation here, it is the whole mechanism: `FieldHost.setTool`
	 *  publishes NOTHING on the plain path (only a set that lands while a momentary
	 *  modifier is held re-derives and fires), so the cell write below is the only thing
	 *  that tells the chrome its own tool changed. */
	setTool: (next: FieldTool) => void;
	/** Adopt + push, and TWO-WAY since the F4.5 holistic gate.
	 *
	 *  It used to be one-way on purpose, and this docblock used to say so: the host's
	 *  wheel and `[` / `]` step the radius without passing through here, and the argument
	 *  was that the ghost ring in the viewport is the live display, so a lagging readout
	 *  cost nothing. **The gate falsified that** — the user sized the brush with the wheel
	 *  and read a stale number off the strip, which is a readout stating something untrue
	 *  about the tool in hand.
	 *
	 *  The mirror rides `subscribeTool` (see `FieldToolPush`), so it added no seam. A
	 *  slider drag DOES round-trip — `applyRadius`'s early return suppresses a NO-OP set
	 *  only, and every drag step is a real change, so each one comes straight back (its
	 *  own comment carries the measurement). What makes that harmless is the adopt below
	 *  it: the echo lands in a cell write carrying the number the chrome already holds, and
	 *  the cell drops an identical value, so the round trip costs no render. The
	 *  out-of-range case is where the early return earns its keep — a set past the clamp
	 *  pushes once at the boundary and the next one finds it already current. */
	setRadius: (r: number) => void;
};

/** Which committed entity the host has selected — `null` for none. */
export type FieldEntitySelectionState = {
	selectedEntityId: number | null;
};

/** What the host currently has selected — `null` for nothing. */
export type FieldSelectionState = {
	selection: SelectionInfo | null;
};

/** The named history: what each undo/redo step would DO, newest-last per side (D-11).
 *  Read by the Undo/Redo menu items through the action context, and by the History
 *  palette. */
export type FieldHistoryState = {
	history: FieldHistory;
};

/** The live stamp/reconfigure session — `null` between sessions. */
export type FieldStampState = {
	stamp: StampSession | null;
};

/** The pending segment the status bar counts out (D-25) — `null` whenever no point is
 *  down, which is most of the time. Read-only: the anchor is the host's, set by clicks
 *  on the canvas the chrome never sees. */
export type FieldSegmentHudState = {
	segment: SegmentHud | null;
};

/** The advisor's findings, the bands the chrome asks for, and the one verify in flight.
 *
 *  `verifying` is CHROME state (the row key stage 2 is running on) because releasing it
 *  takes two signals no single host seam carries: a verdict arrives on `subscribeFlags`,
 *  and each of `verifyFlag`'s refusals arrives on the tool-error seam having pushed no
 *  flags at all. Both halves live in the provider shell below, which is why the cell does
 *  too — a release that only ran while the palette happened to be open would strand the
 *  column the next time it opened. */
export type FieldFlagsState = {
	flags: FlagsSummary;
	filters: FlagFilters;
	setFilters: (next: FlagFilters) => void;
	verifying: string | null;
	/** Adopt BEFORE the call, never after: ALL FOUR of the host's refusals are decided
	 *  synchronously and report on the tool-error seam from inside `verifyFlag` (only a
	 *  stage-2 FAILURE is async), so a write afterwards would overwrite the release that
	 *  refusal just performed and leave the column stuck on a verify that never ran. */
	verify: (key: string) => void;
};

// --- the chrome's own cells -------------------------------------------------
//
// The five values with no host seam to latch. A cell is the smallest thing that makes
// them readable by `useSeam` on the same terms as a host seam: one value, N subscribers,
// the current value pushed synchronously on subscribe (the (re)mount rule
// `view-channel.ts` states, for the same reason — a surface arriving mid-session must not
// render a default beside something the viewport is plainly drawing).
//
// NOT `createViewChannel` itself, which is the same shape one package layer down: the
// chrome may not value-import `viewport-host` (`tests/frontend-no-engine-leakage.test.ts`
// enforces it — the barrel carries core, and a second core in the chrome bundle is the
// bug the project-first invariant exists to prevent). Framework-free anyway, the
// `notify-store.ts` discipline, so the rule it keeps is decided in one readable place.

type Unsubscribe = () => void;

/** Never anything to hear: the release for a subscription that was never made. */
const NEVER: Unsubscribe = (): void => undefined;

/** EXPORTED for one thing only: the release-contract unit in
 *  `tests/chrome/host-seams-and-catalogs.test.tsx`, beside the one that pins the same
 *  contract for the host's thirteen channels. No production code outside this file builds
 *  a cell — the six that exist are `createChromeCells`', made once per provider. */
export type Cell<T> = {
	read(): T;
	/** Drops an IDENTICAL value rather than publishing it, by identity and never by value:
	 *  a comparator belongs to the seam that needs one (`toolsEqual` on the tool mirror),
	 *  not to every cell.
	 *
	 *  BELT AND BRACES rather than the thing that makes an echo free — `useSeam` bails on
	 *  an identical adopt too, and React bails again after that, so removing this changes
	 *  no render (measured: the chrome suite stays green without it). What it buys is that
	 *  a no-op write costs no delivery pass at all, which is the level the cell can decide
	 *  it at and the latch cannot. */
	write(next: T): void;
	subscribe(cb: (value: T) => void): Unsubscribe;
	/** Live subscriber count — the leak-detection seam, and `ViewChannel.size`'s twin for
	 *  the same reason: a count that only climbs across mount/unmount cycles is a release
	 *  that did not run, and with N subscribers that has no other symptom. The unmounted
	 *  surface's latch just keeps being written to. */
	size(): number;
};

export function createCell<T>(initial: T): Cell<T> {
	const subs = new Set<(value: T) => void>();
	let value = initial;
	return {
		read: () => value,
		write(next) {
			if (Object.is(next, value)) return;
			value = next;
			// Over a COPY, HALF of the `view-channel.ts` rule: a subscriber is free to
			// unsubscribe from inside its own delivery (a React commit provoked by one push
			// can tear down the surface holding another), and a live Set mutated
			// mid-iteration would let one subscriber's bookkeeping decide whether its
			// siblings hear this pass.
			//
			// The OTHER half — per-subscriber try/catch, so one thrower does not sever its
			// siblings — is deliberately absent, and this comment says so rather than
			// implying parity. Every subscriber here is `useSeam`'s latch closure, which
			// runs an `adopt` and calls React's store-change handler; that handler
			// SCHEDULES, it does not render, so there is no reachable path by which one
			// cell subscriber throws synchronously inside this loop. Add the isolation if
			// a cell ever grows a subscriber that is not the latch.
			for (const cb of [...subs]) cb(value);
		},
		subscribe(cb) {
			subs.add(cb);
			cb(value);
			return () => {
				subs.delete(cb);
			};
		},
		size: () => subs.size,
	};
}

/** The chrome-owned half of the mirror: one cell per value no surface can hold its own
 *  copy of (this file's header says which five are forced and which one is chosen),
 *  created once per provider (never module-level — two shells in one process, which every
 *  test file is, must not share a brush). */
type ChromeCells = {
	tool: Cell<FieldTool>;
	gesture: Cell<ViewportGesture | null>;
	radius: Cell<number>;
	flags: Cell<FlagsSummary>;
	filters: Cell<FlagFilters>;
	verifying: Cell<string | null>;
	/** The ONE writer the chips call: records that the bands are now the user's, so the
	 *  restore cannot land on top of a choice they have already made. A method rather than
	 *  a plain `filters.write` so that flag cannot be set from anywhere else. */
	editFilters(next: FlagFilters): void;
	/** Whether the bands have been edited by hand yet — read by the restore and the
	 *  debounced write, both of which live in the provider. */
	filtersTouched(): boolean;
};

function createChromeCells(): ChromeCells {
	const filters = createCell<FlagFilters>(DEFAULT_FLAG_FILTERS);
	let touched = false;
	return {
		tool: createCell<FieldTool>(DEFAULT_TOOL),
		gesture: createCell<ViewportGesture | null>(DEFAULT_GESTURE),
		radius: createCell(DEFAULT_RADIUS),
		flags: createCell<FlagsSummary>(NO_FLAGS),
		filters,
		verifying: createCell<string | null>(null),
		editFilters(next) {
			touched = true;
			filters.write(next);
		},
		filtersTouched: () => touched,
	};
}

// --- the one context, and the latch over it ---------------------------------

/** What every hook below needs and nothing more. Its identity moves twice in a session —
 *  when the host arrives and when the engine comes up — which is what keeps a context
 *  every surface reads from re-rendering them all on a slider drag. */
type FieldShell = {
	/** The host, UNGATED: what the verbs push into. The four of them (`setTool`,
	 *  `setRadius`, `setGesture`, `verify`) deliberately do not wait for `engineReady` —
	 *  a control that silently did nothing before the first frame is a dead control. */
	host: FieldHost | undefined;
	/** The SUBSCRIBE gate. Nothing latches a host seam until the engine is up. */
	engineReady: boolean;
	chrome: ChromeCells;
};

const FieldShellContext = createContext<FieldShell | null>(null);

/** Adopt a push into the latch, `setState`'s shape: returning `prev` is how a seam says
 *  "nothing moved", and the latch keeps the previous snapshot IDENTITY so React bails. */
type Latch<T> = (adopt: (prev: T) => T) => void;

/** Wire one value to one shell. Called at SUBSCRIBE time and never during render, which
 *  is why every one below is a module constant: `useSeam` keys its subscription on the
 *  shell alone, and a connect built per render would re-subscribe every time. */
type Connect<T> = (shell: FieldShell, latch: Latch<T>) => Unsubscribe;

/** A connect over the LIVE host — the engine-ready gate, written once. */
function onHost<T>(
	wire: (host: FieldHost, latch: Latch<T>) => Unsubscribe,
): Connect<T> {
	return ({ host, engineReady }, latch) =>
		engineReady && host !== undefined ? wire(host, latch) : NEVER;
}

/** A connect over one chrome cell — a plain mirror, since a cell already drops an
 *  identical value. */
function onCell<T>(pick: (chrome: ChromeCells) => Cell<T>): Connect<T> {
	return ({ chrome }, latch) =>
		pick(chrome).subscribe((value) => latch(() => value));
}

/** Latch one multicast seam into a React-readable snapshot.
 *
 *  ELEVEN of the thirteen host seams push their current state synchronously inside
 *  `subscribe` (`view-channel.ts`'s `snapshot` option, and every cell above does the same),
 *  so the first `getSnapshot` AFTER the subscription effect reads real state. The two that
 *  do not — `subscribeStats` and `subscribeTool` — are EVENT seams by the host's own
 *  choice, and for them `empty` is what the first render shows until the first push
 *  arrives. The first render is `empty` either way: `useSyncExternalStore` reads the
 *  snapshot before React attaches the subscription, exactly as the provider's `useState`
 *  initial value did before it.
 *
 *  `adopt` returning `prev` is the echo guard's chrome half (`../lib/field-host-mirrors.ts`)
 *  — an equal push keeps the previous snapshot IDENTITY, so React bails out and no
 *  re-render happens. */
function useSeam<T>(
	shell: FieldShell | null,
	connect: Connect<T>,
	empty: T,
): T {
	const ref = useRef<T>(empty);
	// The subscription's identity is keyed on the shell and nothing else — `connect` is a
	// module constant. An unstable one would make React tear the subscription down and
	// build it again on every render, which on a snapshot-carrying seam is also a spurious
	// push per render.
	const subscribe = useCallback(
		(onChange: () => void): Unsubscribe => {
			if (shell === null) return NEVER;
			return connect(shell, (adopt) => {
				const next = adopt(ref.current);
				if (Object.is(next, ref.current)) return;
				ref.current = next;
				onChange();
			});
		},
		[shell, connect],
	);
	// getSnapshot MUST return a cached value: React calls it on every render and compares
	// the RESULT by identity, so a freshly built object would re-render forever. The ref
	// is that cache, and every `adopt` above is written to return `prev` when nothing moved.
	return useSyncExternalStore(subscribe, () => ref.current);
}

/** The shell, or a thrown error for the hooks whose values are claims about the host.
 *  `useContext` is the only hook it calls, so the throw cannot straddle a hook order. */
function useShell(who: string): FieldShell {
	const shell = useContext(FieldShellContext);
	if (!shell) throw new Error(`${who} outside <FieldHostStateProvider>`);
	return shell;
}

// --- the connects, one per value --------------------------------------------

/** Nothing stamped yet. Frozen for `NO_FLAGS`' reason: it is the shared initial snapshot
 *  of every latch in the process, so one `.push()` into it would corrupt them all. */
const NO_ENTITIES: readonly FieldEntityInfo[] = Object.freeze([]);

/** No camera here — see `useCameraPose` for why this is a truthful reading rather than a
 *  wiring hole. Deliberately NOT the host's own starting orbit: copying those two numbers
 *  into the chrome would be a constant that silently drifts. */
const IDENTITY_POSE: CameraPose = Object.freeze({ yaw: 0, pitch: 0 });

// Guarded because the host fires it every rAF; an idle field must not re-render the
// status bar 60×/s.
const latchStats = onHost<FieldStats | null>((host, latch) =>
	host.subscribeStats((s) =>
		latch((prev) => (prev !== null && statsEqual(prev, s) ? prev : s)),
	),
);

// Guarded like the stats push and for the same reason at a higher rate: the host
// publishes a pose from every path that applies the orbit, including the ones that move
// only the TARGET (frame-chunks), and an orientation that did not change must not
// re-render the overlay.
const latchPose = onHost<CameraPose>((host, latch) =>
	host.subscribeCameraPose((next) =>
		latch((prev) =>
			prev.yaw === next.yaw && prev.pitch === next.pitch ? prev : next,
		),
	),
);

// Entities refresh strategy (F3a): ONE host-pushed trigger. The host fires
// subscribeEntities from every path that can add, remove or rewrite an entity record —
// commit, reconfigure apply, freeze/unfreeze, bake, ⌘Z/⇧⌘Z, world new/load — plus once on
// subscribe. The tick carries NOTHING: the list is re-read here, so the host stays the
// single source of truth and no payload can be held past its refresh. `sameEntities` is
// what keeps a tick that changed nothing from re-rendering the palette (freeze and bake
// tick without touching a chunk, and every listEntities() call hands back fresh clones —
// so identity alone says nothing).
//
// The READ is outside `adopt`. An adopt must be a pure function of `prev` — React may
// call it twice or replay it, and `listEntities()` walks the whole op log to attribute
// placements. Latent rather than broken today, but the failure it invites is a double log
// walk per tick on a long world.
//
// AND THE FAN-OUT IS REAL, which is worth stating plainly because it is the one cost the
// collapse ADDED rather than removed. This is the only latch whose subscribe callback does
// WORK instead of adopting a pushed payload, and it now runs once per reader: the entities
// palette, the session card, the tool strip and the action registry all call
// `useFieldEntities`, so a tick walks the op log up to four times where the single provider
// walked it once. At least two of those are mounted at any moment (the registry always, the
// strip whenever no session stands). Accepted here rather than fixed: the tick is
// COMMIT-paced — a stamp, a bake, a ⌘Z — not frame- or pointer-paced, and the fix (hoisting
// the read back to one place, or having the host push the list) is a design change this
// commit should not be smuggling in. Revisit if the entity list gets long or the tick gets
// chattier.
const latchEntities = onHost<readonly FieldEntityInfo[]>((host, latch) =>
	host.subscribeEntities(() => {
		const next = host.listEntities();
		latch((prev) => (sameEntities(prev, next) ? prev : next));
	}),
);

// The reconfigure drift report. subscribeDrift pushes clones plus the current report on
// subscribe (a palette re-opened after an apply keeps its findings); dismiss, reset and
// load all push null through the same seam, so the plain adopt is the whole mirror.
//
// No comparator, and NOT because the host only pushes on change — it does not:
// `dismissDrift` on an already-clean report and every `loadWorld` push null regardless. It
// needs none because those redundant pushes are all null, and null against a null snapshot
// is a bail-out by identity. A redundant push of a non-null report cannot happen (only an
// apply that LANDED produces one), which is what makes this safe rather than lucky.
const latchDrift = onHost<FieldDriftReport | null>((host, latch) =>
	host.subscribeDrift((report) => latch(() => report)),
);

// The entity selection — which row is highlighted, and the entity the viewport is boxing.
// Pushed on every change (a `pointer` click, a row click through `host.selectEntity`, and
// the invalidation that fires when the selected entity leaves the log), plus the current
// id on subscribe.
//
// NO value guard, and the reason is a property of the seam rather than of the cadence: the
// host's own `setSelectedEntity` returns early when the resolved id equals the one it
// holds, so a redundant value is never pushed at all — the one seam here whose contract
// makes the guard unnecessary rather than merely affordable. A number adopted over an
// equal number is also a bail-out by identity, so even a host that regressed on that would
// cost nothing.
const latchEntitySelection = onHost<number | null>((host, latch) =>
	host.subscribeEntitySelection((id) => latch(() => id)),
);

// The selection mirror (the count, the truncation warning, Clear / Reselect).
// `subscribeSelection` pushes the CURRENT state on subscribe, so a surface mounting over a
// live selection renders it rather than "no selection".
const latchSelection = onHost<SelectionInfo | null>((host, latch) =>
	host.subscribeSelection((info) => latch(() => info)),
);

// The session mirror. `subscribeStamp` pushes CLONES plus the current session on
// subscribe, so a surface mounting mid-session recovers the live form.
const latchStamp = onHost<StampSession | null>((host, latch) =>
	host.subscribeStamp((s) => latch(() => s)),
);

// The pending SEGMENT (D-25) — how long the capsule the next click would sweep is, and the
// cap it is measured against. The status bar counts it out while the user is still aiming,
// which is the only moment the 60 m limit can still be acted on.
//
// Guarded like the pose above, and for the pose's reason rather than a rate argument: the
// seam builds a FRESH object per push, so an unchanged length would re-render the bar on
// identity alone. That is reachable — a pointermove landing on the same surface point
// resolves the same two endpoints and measures the same metre — and the host's throttle
// bounds how often, not whether. The comparator is written out rather than added to
// `field-host-mirrors.ts`: two numbers with no nesting is not a helper's worth of work, and
// `statsEqual`'s eleven fields are what that module is for.
//
// `null` needs no guard of its own: null against a null snapshot is a bail-out by
// identity, and null is what the anchor edges push most often.
const latchSegment = onHost<SegmentHud | null>((host, latch) =>
	host.subscribeSegmentHud((next) =>
		latch((prev) =>
			prev !== null &&
			next !== null &&
			prev.lenM === next.lenM &&
			prev.capM === next.capM
				? prev
				: next,
		),
	),
);

// The named history (D-11). The host publishes only when the log's two entry stacks really
// moved — several paths tick the entity list without touching them — so this is the whole
// mirror: a comparator here would have nothing left to catch, because the push it would
// guard against is one the host does not make.
const latchHistory = onHost<FieldHistory>((host, latch) =>
	host.subscribeHistory((history) => latch(() => history)),
);

// The PENDING stamp arm (D-F4.5-7) — a stamp picked with nothing selected, waiting on the
// region the user is about to drag. Its own seam rather than a chrome inference, because
// the host owns both halves of the question: whether picking a stamp opened a session or
// asked for a region, and every path that ends the arm (the region landing, the canvas's
// own Esc, arming any tool). Four surfaces read it — the rail's pressed family, the status
// keymap, the canvas cursor and the host's own click routing — and inferring it here is
// how they would disagree.
const latchPendingStamp = onHost<PendingStamp | null>((host, latch) =>
	host.subscribePendingStamp((p) => latch(() => p)),
);

const latchTool = onCell((chrome) => chrome.tool);
const latchGesture = onCell((chrome) => chrome.gesture);
const latchRadius = onCell((chrome) => chrome.radius);
const latchFlags = onCell((chrome) => chrome.flags);
const latchFilters = onCell((chrome) => chrome.filters);
const latchVerifying = onCell((chrome) => chrome.verifying);

// --- the ten hooks ----------------------------------------------------------
//
// Each keeps the NAME and the RETURN SHAPE it had as a context read. What changed is
// where the subscription lives: in the component that calls the hook, so the surfaces
// that do not read a seam do not pay for it.

/** Read the shell's host-state mirror; throws outside the provider.
 *
 *  FRAME-paced — the host pushes a readout every rAF, guarded by `statsEqual` so an idle
 *  field pushes nothing through. Read it only where the numbers are drawn. */
export function useFieldHostState(): FieldHostState {
	const shell = useShell("useFieldHostState");
	const stats = useSeam(shell, latchStats, null);
	return useMemo(() => ({ stats }), [stats]);
}

/** The orbit camera's current orientation. Re-renders its caller on every camera move —
 *  read it only where the orientation is actually drawn (the corner triad).
 *
 *  The TOP of the cadence range: the host pushes a pose on every camera move, so while the
 *  user flies this changes at frame rate.
 *
 *  Defaults to the identity view rather than throwing — an overlay mounted outside the
 *  provider (the harness tests do that) has no pose to read, and a triad drawn down the
 *  −Z axis is a truthful "no camera here". Inside the provider the host's push on
 *  subscribe replaces it on the first effect. */
export function useCameraPose(): CameraPose {
	const shell = useContext(FieldShellContext);
	return useSeam(shell, latchPose, IDENTITY_POSE);
}

/** The committed entities + the standing drift report; throws outside the provider.
 *  Unlike the two defaulting hooks here this one is a hard wiring requirement: its only
 *  consumer is a palette the shell mounts, and an empty list is indistinguishable from a
 *  world that genuinely has no stamps — a silence worth crashing over.
 *
 *  The BOTTOM of the cadence range: entities and drift move when someone COMMITS
 *  something, which is orders of magnitude rarer than a stats push. TWO seams, one
 *  snapshot: they are one concern, and the merge is a `useMemo` so an unchanged half
 *  cannot churn the identity of the whole. */
export function useFieldEntities(): FieldEntitiesState {
	const shell = useShell("useFieldEntities");
	const entities = useSeam(shell, latchEntities, NO_ENTITIES);
	const drift = useSeam(shell, latchDrift, null);
	return useMemo(
		() => ({
			entities,
			drift,
			// Array → Set, and nothing else: the host decided the membership. Built here
			// rather than pushed as a Set so the seam stays plain JSON-shaped data (every
			// other host push is), and rebuilt only when the report itself changes — which
			// is what makes it safe to hand to a row lookup.
			driftedIds: new Set(drift?.entityIds ?? []),
		}),
		[entities, drift],
	);
}

/** The selected committed entity's id (`null` = none); throws outside the provider.
 *  READ-ONLY: selecting goes through the host (`fieldHostRef.current.selectEntity`), the
 *  way every other shell verb does — there is one selection, the host owns it, and a
 *  setter here would be a second way to spell the same write.
 *
 *  CLICK-paced, and its own hook rather than a field on `FieldEntitiesState` beside it:
 *  the list moves when someone COMMITS, the selection when someone CLICKS a different
 *  object, and those are not the same event however similar their rate. Three readers now
 *  take the selection without the list (the move verbs, the session card, the tool strip),
 *  which is what the split was for.
 *
 *  Throws, and the reason is specific to this value rather than borrowed: `null` is a REAL
 *  member of its domain — it means "nothing is selected" — so unlike `useCameraPose`'s
 *  identity pose there is no value here that reads as "nobody asked". A default would put
 *  every row in the unselected style beside a viewport box that is plainly drawn. */
export function useFieldEntitySelection(): FieldEntitySelectionState {
	const shell = useShell("useFieldEntitySelection");
	const selectedEntityId = useSeam(shell, latchEntitySelection, null);
	return useMemo(() => ({ selectedEntityId }), [selectedEntityId]);
}

/** The armed brush plus the verbs that change it; throws outside the provider.
 *
 *  USER-paced: the host pushes a tool on an Alt-click eyedrop and on every momentary ⇧/⌃
 *  press and release, i.e. as fast as fingers move and no faster — except `radius`, which
 *  a slider drag moves at pointer rate.
 *
 *  THREE of its four values are shared cells rather than latches, and all three are
 *  forced rather than chosen.
 *
 *  `gesture` has no seam in either direction, so copies could never be reconciled.
 *
 *  `tool` and `radius` are forced by the SEAM's shape, not by the funnels below: they ride
 *  `subscribeTool`, which is an EVENT channel with no snapshot, and `TopBar` unmounts
 *  `ToolStrip` for the whole of every stamp session. A latch would come back reading the
 *  chrome's defaults beside a brush the viewport is drawing, with no catch-up push coming
 *  to fix it. Be precise about which of the two verbs below publishes, because the obvious
 *  claim is wrong in both directions: `setRadius` DOES round-trip (`applyRadius`
 *  value-compares, then `notifyTool`), while `setTool` publishes nothing on the plain path
 *  at all — which forces `tool` a second time, since this hook has three simultaneous
 *  readers (the strip, the status keymap, the action registry) and a copy each would
 *  diverge the first time anyone picked a brush.
 *
 *  `pendingStamp` has a snapshot behind it, so it is a latch.
 *
 *  Throws, unlike `useCameraPose` and `useFieldHistory` — both reasons are load-bearing: a
 *  defaulted `tool` would claim the host is on dig-into-rock when nobody has asked it
 *  anything, and a defaulted `setTool` would be a silent no-op behind a live-looking button
 *  — the dead-control failure the sibling ACTION contexts (useViewActions,
 *  useWorkspaceActions, useWorldActions) all throw over. */
export function useFieldTool(): FieldToolState {
	const shell = useShell("useFieldTool");
	const { host, chrome } = shell;
	const tool = useSeam(shell, latchTool, DEFAULT_TOOL);
	const gesture = useSeam(shell, latchGesture, DEFAULT_GESTURE);
	const radius = useSeam(shell, latchRadius, DEFAULT_RADIUS);
	const pendingStamp = useSeam(shell, latchPendingStamp, null);

	const setTool = useCallback(
		(next: FieldTool): void => {
			chrome.tool.write(next);
			host?.setTool(next);
		},
		[chrome, host],
	);
	// Adopt + push inside the handler, NOT an effect keyed on the value: this is the
	// pointer-rate half of that criterion (a slider drag pushes per frame, and the effect
	// form would cost a second render pass on every one of them), and it has no mount push
	// to fold in — the chrome's default IS the host's, so there is nothing to correct at
	// engine-ready. Adding one would be a new host call for no disagreement.
	const setRadius = useCallback(
		(r: number): void => {
			chrome.radius.write(r);
			host?.setDigRadius(r);
		},
		[chrome, host],
	);
	// Adopt + push, `setRadius`'s shape and for its reasons: click-rate, no mount push to
	// fold in (the chrome's default IS the host's), and no seam to mirror — the host
	// publishes no gesture, so nothing can push back.
	const setGesture = useCallback(
		(next: ViewportGesture | null): void => {
			chrome.gesture.write(next);
			host?.setGesture(next);
		},
		[chrome, host],
	);

	return useMemo(
		() => ({
			tool,
			gesture,
			radius,
			pendingStamp,
			setTool,
			setGesture,
			setRadius,
		}),
		[tool, gesture, radius, pendingStamp, setTool, setGesture, setRadius],
	);
}

/** What the host has selected; throws outside the provider.
 *
 *  GESTURE-paced: one push per completed box/flood/wand, plus the current state on
 *  subscribe (so a surface mounting over a live selection does not render "no selection"
 *  beside a visible amber overlay).
 *
 *  Throws: `{ selection: null }` reads as "the host has nothing selected", which is a claim
 *  about the host that nobody outside the provider is in a position to make. */
export function useFieldSelection(): FieldSelectionState {
	const shell = useShell("useFieldSelection");
	const selection = useSeam(shell, latchSelection, null);
	return useMemo(() => ({ selection }), [selection]);
}

/** The live stamp/reconfigure session; throws outside the provider.
 *
 *  POINTER-paced while one is live: `subscribeStamp` pushes a clone on every nudge, param
 *  edit and preview run, plus the current session on subscribe (so a remount mid-session
 *  recovers the live form).
 *
 *  Throws, for `useFieldSelection`'s reason: a defaulted `null` claims there is no session
 *  in progress. */
export function useFieldStamp(): FieldStampState {
	const shell = useShell("useFieldStamp");
	const stamp = useSeam(shell, latchStamp, null);
	return useMemo(() => ({ stamp }), [stamp]);
}

/** The pending segment's length against its cap; throws outside the provider.
 *  Re-renders its caller at the stroke cadence while a point is down — read it only
 *  where the number is actually drawn (the status bar's keymap line).
 *
 *  POINTER-paced while one is half-drawn and dead silent otherwise. Its own hook rather
 *  than a field on the tool state beside it, on the cadence axis: `gesture` and `tool` are
 *  read by the tool rail, the top strip and the action registry, so folding a ~25 Hz
 *  readout in with them would repaint all three for the duration of a gesture that concerns
 *  one span of text on the status bar.
 *
 *  Throws, for `useFieldSelection`'s reason: a defaulted `{ segment: null }` is a claim
 *  about the HOST — "no point is down" — and the keymap line would state the idle copy
 *  beside a capsule the viewport is visibly drawing. */
export function useFieldSegmentHud(): FieldSegmentHudState {
	const shell = useShell("useFieldSegmentHud");
	const segment = useSeam(shell, latchSegment, null);
	return useMemo(() => ({ segment }), [segment]);
}

/** The named history. Re-renders its caller on every log mutation — read it where the
 *  labels are actually rendered (the action context, the History palette).
 *
 *  MUTATION-paced: one push per real log change (a stroke, a commit, a ⌘Z), which is the
 *  entity tick's rate and orders of magnitude below the stats push. Its own hook rather
 *  than a field on `FieldEntitiesState` because the two answer different questions — what
 *  the world CONTAINS versus what was DONE to it — and because a brush stroke moves this
 *  one while leaving the entity list alone, which is most of what a user does.
 *
 *  DEFAULTS rather than throws, unlike its neighbours, and the reason is specific to the
 *  value: an empty history means "nothing has been done yet", which is exactly true outside
 *  a provider, and both readers degrade honestly — the Undo/Redo menu items fall back to
 *  their bare verbs (their labels are written to do that) and the palette renders its empty
 *  state. Nothing here is a verb that could be a silent no-op behind a live-looking
 *  control, which is what makes `useFieldTool`'s argument not apply. */
export function useFieldHistory(): FieldHistoryState {
	const shell = useContext(FieldShellContext);
	const history = useSeam(shell, latchHistory, NO_HISTORY);
	return useMemo(() => ({ history }), [history]);
}

/** The advisor's findings, filters and in-flight verify; throws outside the provider.
 *
 *  ANSWER-paced: a push per analyzer response and per filter change, which is the slowest
 *  cadence in this file and the reason it needs no value-equality guard where the stats
 *  mirror does.
 *
 *  All three values are shared cells. `flags` could be a latch — one reader, slowest seam —
 *  but its push and the `verifying` release are ONE effect in the provider (see there), and
 *  splitting them would be two subscriptions to `subscribeFlags` to express one coupling.
 *  `filters` and `verifying` cannot be latches at all: `PaletteLayer` unmounts a closed
 *  palette's body, so per-consumer state would lose the user's bands to a debounce the
 *  unmount cancelled, and would drop a verify the host is still running.
 *
 *  Throws: every field here is a claim about work the host has or has not done — an empty
 *  summary reads as "the advisor found nothing", a null `verifying` as "no verify is
 *  running" — and `setFilters`/`verify` would be silent no-ops behind live controls
 *  (`useFieldTool`'s reason). */
export function useFieldFlags(): FieldFlagsState {
	const shell = useShell("useFieldFlags");
	const { host, chrome } = shell;
	const flags = useSeam(shell, latchFlags, NO_FLAGS);
	const filters = useSeam(shell, latchFilters, DEFAULT_FLAG_FILTERS);
	const verifying = useSeam(shell, latchVerifying, null);

	const verify = useCallback(
		(key: string): void => {
			chrome.verifying.write(key);
			host?.verifyFlag(key);
		},
		[chrome, host],
	);

	return useMemo(
		() => ({
			flags,
			filters,
			// Already stable — a method on a record built once per provider.
			setFilters: chrome.editFilters,
			verifying,
			verify,
		}),
		[flags, filters, chrome, verifying, verify],
	);
}

// --- the provider shell -----------------------------------------------------

export function FieldHostStateProvider({
	host,
	engineReady,
	store,
	children,
}: {
	host: FieldHost | undefined;
	engineReady: boolean;
	/** The per-project persistence blob, or undefined until the project root
	 *  resolves. ONE key is read and written here — `flagFilters` — and the reason
	 *  it is this provider's rather than a palette's is the same reason the cell
	 *  is: the host outlives every palette, and a surface that re-pushed its
	 *  defaults on each remount would silently untick the user's bands. */
	store?: UiStore;
	children: ReactNode;
}) {
	// One set per provider, built once. Never module-level: two shells in one process —
	// which every chrome test file is — must not share a brush or a set of bands.
	const [chrome] = useState(createChromeCells);
	const shell = useMemo<FieldShell>(
		() => ({ host, engineReady, chrome }),
		[host, engineReady, chrome],
	);

	// Mirror HOST-initiated tool changes (Alt-click eyedropper, momentary Shift/Ctrl
	// overrides). ECHO GUARD (binding rider): a chrome `setTool` that lands while a
	// momentary modifier is held makes the host re-derive and fire THIS callback with the
	// DERIVED tool — so the mirror ADOPTS only (a cell write, never a `host.setTool`
	// re-push: pushing the derived tool back would re-derive → re-fire → loop), and
	// value-compares first so an echo of our own tool changes nothing. `toolsEqual` is the
	// only real half of that guard — the host publishes a fresh clone per push, so identity
	// alone would re-render every reader of the tool on every momentary tap.
	// The RADIUS half arrived with the F4.5 gate's W-2: the host's wheel and `[` / `]` reach
	// the radius without passing through the chrome, so the readout used to keep whatever
	// number the chrome last set. Both halves land in one push and are adopted independently
	// — the tool through its value comparison, the radius through the cell's own identity
	// check on a number, which is free.
	//
	// HERE rather than in `useFieldTool` because the values it writes are shared: see that
	// hook for why a per-consumer tool cannot work.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeTool(({ tool, radius }) => {
			if (!toolsEqual(chrome.tool.read(), tool)) chrome.tool.write(tool);
			chrome.radius.write(radius);
		});
	}, [engineReady, host, chrome]);

	// What the host has to SAY: its user-facing refusals (selection-mask misuse, an
	// empty flood, the void-cast budget, all four verify guards) and — since F4.5c —
	// the one report that refuses nothing, the advisor standing down over a project
	// with no agent profile. They go STRAIGHT to the toast stack — the F3b gate found
	// them landing on a shared footer line where they read indistinguishably from
	// routine info, i.e. as dead features. A toast is toned, is over the canvas the
	// user is looking at, and outlives the next message.
	//
	// Nothing is mirrored into a cell: the toast IS the render, and a second copy in the
	// chrome would be a second thing to keep in agreement with it. It stays the SHELL's
	// subscription for the same reason — a message belongs to no one surface, and a toast
	// that only appeared while some palette happened to be open would be a dead feature
	// again.
	//
	// The SEVERITY is the host's word and is passed straight through: the two strings the
	// seam carries are `NotifySeverity` members, so the tone, the fade rule and the ⚠
	// chip's count all follow from it with nothing to translate. A `warn` is the advisor
	// standing down over a project with no agent profile — routed as an error it opened a
	// clean boot with a red unread badge, which is the whole reason the member exists.
	//
	// An ERROR also RELEASES any verify in flight, which is the second half of a pairing
	// whose first half is the flags push below. Every `verifyFlag` refusal reports here
	// having pushed no flags at all, so this is the only signal that a verify the user
	// started never actually began; without it the column would read "Verifying…" until
	// the next analyzer response. Deliberately blunt WITHIN that severity — an unrelated
	// tool error (a failed stroke) releases it too. That way round is the safe one: the
	// host still refuses a real second verify with "a verify is already running", so the
	// cost is a button that looks live for a moment, against a column that sticks for
	// good.
	//
	// A `warn` does NOT release it, and the asymmetry is the same trade read the other
	// way. All four verify refusals are errors, so nothing that can strand the column
	// arrives as a warning — releasing on one would only ever blank a "Verifying…" that
	// is telling the truth, paying the cost with none of the cover. If a warning ever
	// becomes a way a verify can fail to start, it belongs on this branch too.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeToolError((text, severity) => {
			if (severity === "warn") {
				notify.warn(text);
				return;
			}
			notify.error(text);
			chrome.verifying.write(null);
		});
	}, [engineReady, host, chrome]);

	// The advisor's findings. Pushed after every analyzer response and every
	// `setFlagFilters` (plus the current summary on subscribe). Answer-paced, not
	// frame-paced — which is why, unlike the stats latch above, this needs no
	// value-equality guard.
	//
	// ANY push releases the in-flight verify, not just the one carrying its verdict: a
	// re-analysis that landed mid-verify may have replaced the row the key names, and
	// holding the column against a row that no longer exists would disable every Verify in
	// the list with no way back. (The refusal half of that release is the tool-error
	// effect above.) The release is why this subscription is the SHELL's and not the
	// palette's: it has to run while the palette is closed, which is most of the time.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeFlags((summary) => {
			chrome.flags.write(summary);
			chrome.verifying.write(null);
		});
	}, [engineReady, host, chrome]);

	// The filters are CHROME state pushed into the host, which has no filters seam to
	// mirror — so this is a one-way push, keyed on the value, the useView pattern. Keying
	// it on `filters` folds engine-ready and every later edit into ONE mechanism, which
	// matters because this value has to be pushed at MOUNT as well as on change: the host
	// keeps the last set across a world load, so silence at mount would leave freshly
	// rendered checkboxes describing bands the host is not actually drawing.
	//
	// Deliberately NOT the shape `setTool`/`setRadius` use (push inside the handler), and
	// the criterion is that mount push plus cadence. This one is click-rate — three
	// checkboxes — so the effect form's cost is invisible; the brush verbs are pointer-rate
	// (a slider drag) and would pay it every frame. The cost is real and worth naming: a
	// toggle here renders twice rather than once, and for one frame between them the box
	// shows the new band while the host still holds the old. That window is why the
	// "one mechanism" above is about mount-vs-edit agreement, not about the chrome and the
	// host being in lockstep within a frame — they are not, and nothing here needs them to
	// be (a filter is a view over findings the host has already computed).
	//
	// Living HERE rather than in a palette is what makes the arrangement honest: the host
	// outlives every palette, so a surface that re-pushed its defaults on each remount
	// would silently untick the user's bands — closing and re-opening the palette that
	// holds them is a live gesture (the burger's checkbox is the way back), not a
	// hypothetical, and `PaletteLayer` really does unmount a closed body. This provider
	// mounts once, with the shell. Remembering the set ACROSS sessions is D-3's.
	const filters = useSeam(shell, latchFilters, DEFAULT_FLAG_FILTERS);
	useEffect(() => {
		if (!engineReady || !host) return;
		host.setFlagFilters(filters);
	}, [engineReady, host, filters]);

	// D-F4.5-3's half of the same value: the bands are a READING PREFERENCE, and the
	// one thing the effect above cannot do is remember them across a restart.
	//
	// The useView pair, and for its reasons: nothing is written before the first
	// interaction (so the defaults rendered here can never overwrite a blob this
	// component has not read yet), and a restore that arrives after the user has
	// already changed something is dropped rather than yanking their filters out from
	// under them. The store is keyed by the project root, which comes from a daemon
	// call that can fail or never resolve — so the chips render their defaults
	// immediately and adopt the persisted set when (if) the store shows up.
	//
	// WHO WINS AT BOOT, since the host also keeps its last set across a world load:
	// the CHROME does, unconditionally. The restore lands in the cell, the push effect
	// above is keyed on that cell's value, so the host is told what the user last chose.
	// The host's own retention is what keeps the two agreeing across a `loadWorld` — where
	// nothing here re-pushes — and never contradicts this, because a fresh host starts
	// on the same defaults these do.
	const filtersRestored = useRef(false);
	useEffect(() => {
		if (!store || filtersRestored.current) return;
		filtersRestored.current = true;
		if (chrome.filtersTouched()) return;
		const stored = store.get("flagFilters");
		// A cold start keeps the value the cell already has rather than adopting an
		// equal-valued new one: `deserializeFilters(undefined)` IS the defaults, and a
		// fresh identity would re-fire the push effect above for nothing.
		if (!stored) return;
		chrome.filters.write(deserializeFilters(stored));
	}, [store, chrome]);

	// Debounced by effect cleanup: each change cancels the previous pending write.
	useEffect(() => {
		if (!store || !chrome.filtersTouched()) return;
		const timer = setTimeout(
			() => store.set("flagFilters", { ...filters }),
			PERSIST_DEBOUNCE_MS,
		);
		return () => clearTimeout(timer);
	}, [store, filters, chrome]);

	return (
		<FieldShellContext.Provider value={shell}>
			{children}
		</FieldShellContext.Provider>
	);
}
