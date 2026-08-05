// The ONE subscription point for the host seams the chrome reads.
//
// Every FieldHost subscribe seam is MULTICAST (T3a: `viewport-host/view-channel.ts`), so
// a second subscriber no longer steals the first's callback — it is simply a second
// mirror of the same state, paying for the same pushes, the same comparisons and the same
// re-renders twice, and leaking a live subscriber if its cleanup ever fails to run. The
// shell has several consumers that want the same readout, and the dissolving control
// stack became several more, so the subscriptions live here, once, and the consumers read
// them out of context. Nothing below this provider may subscribe to anything it owns.
//
// That rule used to enforce itself, loudly and by accident (the displaced surface went
// dead). It does not any more: a duplicate subscription is now invisible at runtime, and
// the only thing that catches one is the ownership case in
// `tests/chrome/host-seams-and-catalogs.test.tsx`, which counts claims and delivered
// subscribers across the whole mounted shell.
//
// ALL THIRTEEN seams are here: `subscribeStats` (the status bar's chips),
// `subscribeToolError` (a toast, plus the verify release below), `subscribeCameraPose` (the
// corner axis triad), the entity pair `subscribeEntities` + `subscribeDrift` (the entities
// palette), `subscribeEntitySelection` (which row is selected, the box the viewport draws
// for it, and the session card's REST subject), `subscribePendingStamp` (a stamp armed for
// region-draw — the rail, the status keymap and the canvas cursor), and the four the
// control stack held until F4.5b: `subscribeTool` (the tool rail's armed family and the
// strip's params), `subscribeSelection` (the selection verbs), `subscribeStamp` (the
// session card) and `subscribeFlags` (the advisor's list). `subscribeHistory` (F4.5b
// Task 12) names what each undo/redo step DID, in words, and `subscribeSegmentHud`
// (F4.5c Task 14) is the newest: how long the pending segment is against its cap.
//
// Two values here are NOT their own seam: the armed `gesture` and the brush `radius`.
// `gesture` is chrome state pushed one way into the host — `setGesture` has nothing
// behind it, and never will. `radius` was the same until the F4.5 gate's W-2 made it a
// two-way MIRROR: it still has no seam OF ITS OWN, but it rides `subscribeTool`
// alongside the tool (see `FieldToolPush`), so the host's wheel and `[` / `]` reach it.
// Both sit here rather than in `useView` because they belong to the DIG LOOP (useView's
// line), and because every surface that shows one also shows `tool` — the top strip, the
// status bar's keymap line, and the action registry's family keys, which arm the same slot.
//
// They publish through TEN contexts, split by CADENCE rather than by owner: a seam that
// pushes at frame rate must not re-render a surface that only cares about something
// answered once a minute. Each context's own docblock states its cadence, and its
// throw-vs-default call with the reason for it. `subscribeToolError` is the one seam with
// no context of its own — its message goes straight to the toast stack, and the only state
// it releases (an in-flight verify) lives in this same file now.
//
// The PURE half of this mirror — the value-equality comparators the push guards below
// call, the literals the state opens at, and the filter restore — lives in
// `../lib/field-host-mirrors.ts`, where each is directly unit-testable. Nothing with
// React in it went with them: the subscriptions are what the one-file rule above is
// about, and `PERSIST_DEBOUNCE_MS` below stays because it tunes an EFFECT here rather
// than describing a mirrored value.
import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
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
 *  context because they are one concern (what has been stamped, and what the last
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
 *  in one context rather
 *  than the state/actions PAIR the sibling providers use (useView, useWorkspace,
 *  useWorld): the adopt and the push here are ONE concern that cannot be separated —
 *  see the echo guard on the mirror effect — and useView's own header says to delete
 *  that split rather than defend it where nobody benefits. Every consumer of this
 *  context both shows the tool and changes it. */
export type FieldToolState = {
	tool: FieldTool;
	/** What LMB is armed to do — `null` = the brush strokes. CHROME state pushed one way
	 *  into the host — and the only one left: `setGesture` has no subscription behind it
	 *  (nor anything riding another seam, which is where `radius` went at the F4.5 gate),
	 *  so this is a MIRROR by construction rather than by echo, and it opens at `"pointer"`
	 *  because that is what a fresh host is already armed with (D-F4.5-7).
	 *
	 *  It lives up here rather than in the panel that used to hold it because several
	 *  surfaces now write it — the tool rail's family buttons and member flyouts, the
	 *  action registry's `V`/`B`/`M` family keys, and `armBrush` — while the status bar's
	 *  keymap line reads it. A per-surface copy would disagree the moment a key armed
	 *  something a button was showing. */
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
	 *  landing). Read-only here for that reason — `host.startStamp` is what sets it. */
	pendingStamp: PendingStamp | null;
	/** Arm what LMB does — adopt + push, the ONE funnel, exactly as `setTool` is. */
	setGesture: (next: ViewportGesture | null) => void;
	/** Adopt + push, the ONE funnel for a tool change. The host clamps (smooth ceilings,
	 *  hollow floor) as a backstop; the controls stay inside the same ranges so chrome
	 *  and host agree. */
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
	 *  it: the echo lands in a plain `setRadiusState` with the number the chrome already
	 *  holds, and React bails out on an identical value, so the round trip costs no
	 *  render. The out-of-range case is where the early return earns its keep — a set past
	 *  the clamp pushes once at the boundary and the next one finds it already current. */
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
 *  flags at all. Both halves live in this file, which is why the state does too. */
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

const FieldHostStateContext = createContext<FieldHostState | null>(null);

/** The orbit camera's orientation, in its own context at the TOP of the cadence range:
 *  the host pushes a pose on every camera move, so while the user flies this changes at
 *  frame rate. Folding it into FieldHostState would re-render the status bar 60×/s during
 *  a fly, which is exactly what the split exists to prevent.
 *
 *  Defaults to the identity view rather than throwing — an overlay mounted outside the
 *  provider (the harness tests do that) has no pose to read, and a triad drawn down the
 *  −Z axis is a truthful "no camera here". Deliberately NOT the host's own starting orbit:
 *  copying those two numbers into the chrome would be a constant that silently drifts,
 *  and inside the provider the host's push on subscribe replaces this on the first
 *  effect. */
const CameraPoseContext = createContext<CameraPose>({ yaw: 0, pitch: 0 });

/** The entity concern, in its own context from the BOTTOM of that range: entities and
 *  drift move when someone COMMITS something, which is orders of magnitude rarer than a
 *  stats push. Folding them into FieldHostState would re-render the entities list on
 *  every remesh — a list of rows repainting under a dig it has nothing to do with. */
const FieldEntitiesContext = createContext<FieldEntitiesState | null>(null);

/** Which entity is selected, CLICK-paced and kept apart from the entity list beside it.
 *
 *  The split pays NOTHING today, and saying so is the honest version: the entities palette
 *  is currently the only reader and it consumes BOTH contexts, so a selection change
 *  re-renders it — list, rows and drift report — exactly as it would if the id rode
 *  `FieldEntitiesState`. What the split is for is the readers arriving next, which read
 *  the selection and not the list: Task 5's move verbs (the selected entity is what they
 *  translate) and Task 10's session card. That is the same "get the shape right before the
 *  consumers arrive, not after" the four contexts below were built on, and cadence is the
 *  axis for their reason too — the list moves when someone COMMITS, the selection when
 *  someone CLICKS a different object, and those are not the same event however similar
 *  their rate. No measurement has been taken of either, and none is claimed.
 *
 *  Throws outside the provider, and the reason is specific to this value rather than
 *  borrowed: `null` is a REAL member of its domain — it means "nothing is selected" — so
 *  unlike CameraPoseContext's identity pose there is no value here that reads as "nobody
 *  asked". A default would put every row in the unselected style beside a viewport box
 *  that is plainly drawn, which is the disagreement between palette and viewport that
 *  having ONE selection concept exists to prevent. */
const FieldEntitySelectionContext =
	createContext<FieldEntitySelectionState | null>(null);

// The four contexts below carry the dig loop's user-paced state, and the split along
// CADENCE is the one that pays. Keeping them out of the frame-paced FieldHostState is a
// live saving in every arrangement: folding any of them into the stats value would
// repaint a form-heavy subtree on every remesh.
//
// Splitting them from EACH OTHER was speculative when it was written — FieldPanel read
// all four, so a stamp nudge re-rendered the same subtree whichever context carried it —
// and the bet is now settled by the surfaces that replaced the panel. The tool strip
// (Task 8) reads the tool context, the flags palette (Task 13) reads the flags context,
// the session card (Task 10) reads the stamp context, and the status bar's selection chip
// reads the selection one. Four contexts, four consumers, no consumer reading a context
// it does not need. The segment HUD (F4.5c) sits in this run as a FIFTH and is not part
// of that bet — it arrived with its reader already known — but it is here on the same
// terms, and the count above is about those four.

/** The brush concern, USER-paced: the host pushes a tool on an Alt-click eyedrop and on
 *  every momentary ⇧/⌃ press and release, i.e. as fast as fingers move and no faster.
 *
 *  Throws outside the provider, unlike CameraPoseContext above — the one DEFAULTED context
 *  in this file, and the only one whose default value is true anywhere ("no camera here").
 *  Both reasons here are load-bearing: a defaulted `tool` would claim the host is on
 *  dig-into-rock when nobody has asked it anything, and a defaulted `setTool` would be a
 *  silent no-op behind a live-looking button — the dead-control failure the sibling ACTION
 *  contexts (useViewActions, useWorkspaceActions, useWorldActions) all throw over. */
const FieldToolContext = createContext<FieldToolState | null>(null);

/** The selection concern, GESTURE-paced: one push per completed box/flood/wand, plus the
 *  current state on subscribe (so a surface mounting over a live selection does not render
 *  "no selection" beside a visible amber overlay). Kept apart from the stamp context beside
 *  it because a stamp nudge pushes at pointer rate while this moves once per gesture — the
 *  widest cadence gap among the four, and so the split most worth having in place before
 *  the two have separate readers.
 *
 *  Throws: `{ selection: null }` reads as "the host has nothing selected", which is a
 *  claim about the host that nobody outside the provider is in a position to make — the
 *  FieldEntitiesContext rule, one concern over. */
const FieldSelectionContext = createContext<FieldSelectionState | null>(null);

/** The session concern, POINTER-paced while one is live: `subscribeStamp` pushes a clone
 *  on every nudge, param edit and preview run, plus the current session on subscribe (so
 *  a remount mid-session recovers the live form). The fast side of the pair above.
 *
 *  Throws, for the FieldSelectionContext reason: a defaulted `null` claims there is no
 *  session in progress. */
const FieldStampContext = createContext<FieldStampState | null>(null);

/** The pending segment, POINTER-paced while one is half-drawn and dead silent otherwise.
 *  A LATER arrival than the four above, and not one of them — it has its own single
 *  reader on the same terms.
 *
 *  Its own context rather than a field on the tool context beside it, on the cadence
 *  axis those four are split by: `gesture` and `tool` are read by the tool rail, the top
 *  strip and the action registry, so folding a ~25 Hz readout into their value would
 *  repaint all three for the duration of a gesture that concerns one span of text on the
 *  status bar.
 *
 *  Throws, for the FieldSelectionContext reason: a defaulted `{ segment: null }` is a
 *  claim about the HOST — "no point is down" — that nobody outside the provider is in a
 *  position to make, and the keymap line would state the idle copy beside a capsule the
 *  viewport is visibly drawing. */
const FieldSegmentHudContext = createContext<FieldSegmentHudState | null>(null);

/** The history concern, MUTATION-paced: one push per real log change (a stroke, a commit,
 *  a ⌘Z), which is the entity tick's rate and orders of magnitude below the stats push.
 *  Its own context rather than a field on `FieldEntitiesState` because the two answer
 *  different questions — what the world CONTAINS versus what was DONE to it — and because
 *  a brush stroke moves this one while leaving the entity list alone, which is most of
 *  what a user does.
 *
 *  DEFAULTS rather than throws, unlike its neighbours, and the reason is specific to the
 *  value: an empty history means "nothing has been done yet", which is exactly true
 *  outside a provider, and both readers degrade honestly — the Undo/Redo menu items fall
 *  back to their bare verbs (their labels are written to do that) and the palette renders
 *  its empty state. Nothing here is a verb that could be a silent no-op behind a
 *  live-looking control, which is what makes the FieldToolContext argument not apply. */
const FieldHistoryContext = createContext<FieldHistoryState>({
	history: NO_HISTORY,
});

/** The advisor concern, ANSWER-paced: a push per analyzer response and per filter change,
 *  which is the slowest cadence in this file and the reason it needs no value-equality
 *  guard where the stats mirror does.
 *
 *  Throws: every field here is a claim about work the host has or has not done — an empty
 *  summary reads as "the advisor found nothing", a null `verifying` as "no verify is
 *  running" — and `setFilters`/`verify` would be silent no-ops behind live controls
 *  (the FieldToolContext reason). */
const FieldFlagsContext = createContext<FieldFlagsState | null>(null);

/** Read the shell's host-state mirror; throws outside the provider. */
export function useFieldHostState(): FieldHostState {
	const value = useContext(FieldHostStateContext);
	if (!value)
		throw new Error("useFieldHostState outside <FieldHostStateProvider>");
	return value;
}

/** The orbit camera's current orientation. Re-renders its caller on every camera move —
 *  read it only where the orientation is actually drawn (the corner triad). */
export function useCameraPose(): CameraPose {
	return useContext(CameraPoseContext);
}

/** The committed entities + the standing drift report; throws outside the provider.
 *  Unlike the two defaulted contexts above this one is a hard wiring requirement: its
 *  only consumer is a palette the shell mounts, and an empty list is indistinguishable
 *  from a world that genuinely has no stamps — a silence worth crashing over. */
export function useFieldEntities(): FieldEntitiesState {
	const value = useContext(FieldEntitiesContext);
	if (!value)
		throw new Error("useFieldEntities outside <FieldHostStateProvider>");
	return value;
}

/** The selected committed entity's id (`null` = none); throws outside the provider.
 *  READ-ONLY: selecting goes through the host (`fieldHostRef.current.selectEntity`), the
 *  way every other shell verb does — there is one selection, the host owns it, and a
 *  setter here would be a second way to spell the same write. */
export function useFieldEntitySelection(): FieldEntitySelectionState {
	const value = useContext(FieldEntitySelectionContext);
	if (!value)
		throw new Error("useFieldEntitySelection outside <FieldHostStateProvider>");
	return value;
}

/** The armed brush plus the verbs that change it; throws outside the provider. */
export function useFieldTool(): FieldToolState {
	const value = useContext(FieldToolContext);
	if (!value) throw new Error("useFieldTool outside <FieldHostStateProvider>");
	return value;
}

/** What the host has selected; throws outside the provider. */
export function useFieldSelection(): FieldSelectionState {
	const value = useContext(FieldSelectionContext);
	if (!value)
		throw new Error("useFieldSelection outside <FieldHostStateProvider>");
	return value;
}

/** The live stamp/reconfigure session; throws outside the provider. */
export function useFieldStamp(): FieldStampState {
	const value = useContext(FieldStampContext);
	if (!value) throw new Error("useFieldStamp outside <FieldHostStateProvider>");
	return value;
}

/** The pending segment's length against its cap; throws outside the provider.
 *  Re-renders its caller at the stroke cadence while a point is down — read it only
 *  where the number is actually drawn (the status bar's keymap line). */
export function useFieldSegmentHud(): FieldSegmentHudState {
	const value = useContext(FieldSegmentHudContext);
	if (!value)
		throw new Error("useFieldSegmentHud outside <FieldHostStateProvider>");
	return value;
}

/** The named history. Re-renders its caller on every log mutation — read it where the
 *  labels are actually rendered (the action context, the History palette). */
export function useFieldHistory(): FieldHistoryState {
	return useContext(FieldHistoryContext);
}

/** The advisor's findings, filters and in-flight verify; throws outside the provider. */
export function useFieldFlags(): FieldFlagsState {
	const value = useContext(FieldFlagsContext);
	if (!value) throw new Error("useFieldFlags outside <FieldHostStateProvider>");
	return value;
}

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
	 *  it is this provider's rather than a palette's is the same reason the state
	 *  is: the host outlives every palette, and a surface that re-pushed its
	 *  defaults on each remount would silently untick the user's bands. */
	store?: UiStore;
	children: ReactNode;
}) {
	const [stats, setStats] = useState<FieldStats | null>(null);
	const [pose, setPose] = useState<CameraPose>({ yaw: 0, pitch: 0 });
	const [entities, setEntities] = useState<readonly FieldEntityInfo[]>([]);
	const [drift, setDrift] = useState<FieldDriftReport | null>(null);
	const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
	const [tool, setToolState] = useState<FieldTool>(DEFAULT_TOOL);
	const [gesture, setGestureState] = useState<ViewportGesture | null>(
		DEFAULT_GESTURE,
	);
	const [radius, setRadiusState] = useState(DEFAULT_RADIUS);
	const [pendingStamp, setPendingStamp] = useState<PendingStamp | null>(null);
	const [selection, setSelection] = useState<SelectionInfo | null>(null);
	const [stamp, setStamp] = useState<StampSession | null>(null);
	const [segment, setSegment] = useState<SegmentHud | null>(null);
	const [history, setHistory] = useState<FieldHistory>(NO_HISTORY);
	const [flags, setFlags] = useState<FlagsSummary>(NO_FLAGS);
	const [filters, setFilters] = useState<FlagFilters>(DEFAULT_FLAG_FILTERS);
	const [verifying, setVerifying] = useState<string | null>(null);

	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeStats((s) =>
			setStats((prev) => (prev !== null && statsEqual(prev, s) ? prev : s)),
		);
	}, [engineReady, host]);

	// What the host has to SAY: its user-facing refusals (selection-mask misuse, an
	// empty flood, the void-cast budget, all four verify guards) and — since F4.5c —
	// the one report that refuses nothing, the advisor standing down over a project
	// with no agent profile. They go STRAIGHT to the toast stack — the F3b gate found
	// them landing on a shared footer line where they read indistinguishably from
	// routine info, i.e. as dead features. A toast is toned, is over the canvas the
	// user is looking at, and outlives the next message.
	//
	// No message is mirrored into context: the toast IS the render, and a second copy in
	// React state would be a second thing to keep in agreement with it.
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
			setVerifying(null);
		});
	}, [engineReady, host]);

	// The camera pose, for the corner orientation triad. Guarded like the stats push and
	// for the same reason at a higher rate: the host publishes a pose from every path that
	// applies the orbit, including the ones that move only the TARGET (frame-chunks), and
	// an orientation that did not change must not re-render the overlay.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeCameraPose((next) =>
			setPose((prev) =>
				prev.yaw === next.yaw && prev.pitch === next.pitch ? prev : next,
			),
		);
	}, [engineReady, host]);

	// Entities refresh strategy (F3a): ONE host-pushed trigger. The host fires
	// subscribeEntities from every path that can add, remove or rewrite an entity record
	// — commit, reconfigure apply, freeze/unfreeze, bake, ⌘Z/⇧⌘Z, world new/load — plus
	// once on subscribe. The tick carries NOTHING: the list is re-read here, so the host
	// stays the single source of truth and no payload can be held past its refresh.
	// `sameEntities` is what keeps a tick that changed nothing from re-rendering the
	// palette (freeze and bake tick without touching a chunk, and every listEntities()
	// call hands back fresh clones — so identity alone says nothing).
	const refreshEntities = useCallback((): void => {
		if (!host) return;
		// READ outside the updater. A state updater must be a pure function of `prev` —
		// React may call it twice (StrictMode) or replay it, and `listEntities()` walks the
		// whole op log to attribute placements. Latent rather than broken today, but the
		// failure it invites is a double log walk per tick on a long world.
		const next = host.listEntities();
		setEntities((prev) => (sameEntities(prev, next) ? prev : next));
	}, [host]);

	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeEntities(refreshEntities);
	}, [engineReady, host, refreshEntities]);

	// The reconfigure drift report. subscribeDrift pushes clones plus the current report
	// on subscribe (a palette re-opened after an apply keeps its findings); dismiss,
	// reset and load all push null through the same seam, so setDrift is the whole mirror.
	//
	// No comparator, and NOT because the host only pushes on change — it does not:
	// `dismissDrift` on an already-clean report and every `loadWorld` push null
	// regardless. It needs none because those redundant pushes are all null, and
	// `setDrift(null)` against a null state is a no-op React bails out of by identity.
	// A redundant push of a non-null report cannot happen (only an apply that LANDED
	// produces one), which is what makes this safe rather than lucky.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeDrift(setDrift);
	}, [engineReady, host]);

	// The entity selection — which row is highlighted, and the entity the viewport is
	// boxing. Pushed on every change (a `pointer` click, a row click through
	// `host.selectEntity`, and the invalidation that fires when the selected entity
	// leaves the log), plus the current id on subscribe.
	//
	// NO value guard, and the reason is a property of the seam rather than of the
	// cadence: the host's own `setSelectedEntity` returns early when the resolved id
	// equals the one it holds, so a redundant value is never pushed at all — the one
	// seam in this file whose contract makes the guard unnecessary rather than merely
	// affordable. A `useState` set to the same NUMBER is also a React bail-out by
	// identity, so even a host that regressed on that would cost nothing here. The
	// mirror is therefore the whole effect.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeEntitySelection(setSelectedEntityId);
	}, [engineReady, host]);

	// Mirror HOST-initiated tool changes (Alt-click eyedropper, momentary Shift/Ctrl
	// overrides). ECHO GUARD (binding rider): a chrome `setTool` that lands while a
	// momentary modifier is held makes the host re-derive and fire THIS callback with the
	// DERIVED tool — so the mirror ADOPTS only (a state write, never a `host.setTool`
	// re-push: pushing the derived tool back would re-derive → re-fire → loop), and
	// value-compares first so an echo of our own state returns the same reference.
	// The RADIUS half arrived with the F4.5 gate's W-2: the host's wheel and `[` / `]`
	// reach the radius without passing through the chrome, so the readout used to keep
	// whatever number the chrome last set. Both halves land in one push and are adopted
	// independently — the tool through its value comparison, the radius through the
	// setter's own identity check on a number, which is free.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeTool(({ tool: t, radius: r }) => {
			setToolState((prev) => (toolsEqual(prev, t) ? prev : t));
			setRadiusState(r);
		});
	}, [engineReady, host]);

	// The selection mirror (the count, the truncation warning, Clear / Reselect).
	// `subscribeSelection` pushes the CURRENT state on subscribe, so a surface mounting
	// over a live selection renders it rather than "no selection".
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeSelection(setSelection);
	}, [engineReady, host]);

	// The session mirror. `subscribeStamp` pushes CLONES plus the current session on
	// subscribe, so a surface mounting mid-session recovers the live form.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeStamp(setStamp);
	}, [engineReady, host]);

	// The pending SEGMENT (D-25) — how long the capsule the next click would sweep is,
	// and the cap it is measured against. The status bar counts it out while the user is
	// still aiming, which is the only moment the 60 m limit can still be acted on.
	//
	// Guarded like the pose above, and for the pose's reason rather than a rate argument:
	// the seam builds a FRESH object per push, so an unchanged length would re-render the
	// bar on identity alone. That is reachable — a pointermove landing on the same surface
	// point resolves the same two endpoints and measures the same metre — and the host's
	// throttle bounds how often, not whether. The comparator is written out rather than
	// added to `field-host-mirrors.ts`: two numbers with no nesting is not a helper's
	// worth of work, and `statsEqual`'s eleven fields are what that module is for.
	//
	// `null` needs no guard of its own: `setSegment(null)` against a null state is a
	// React bail-out by identity, and null is what the anchor edges push most often.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeSegmentHud((next) =>
			setSegment((prev) =>
				prev !== null &&
				next !== null &&
				prev.lenM === next.lenM &&
				prev.capM === next.capM
					? prev
					: next,
			),
		);
	}, [engineReady, host]);

	// The PENDING stamp arm (D-F4.5-7) — a stamp picked with nothing selected, waiting
	// on the region the user is about to drag. Its own seam rather than a chrome
	// inference, because the host owns both halves of the question: whether picking a
	// stamp opened a session or asked for a region, and every path that ends the arm
	// (the region landing, the canvas's own Esc, arming any tool). Four surfaces read
	// it — the rail's pressed family, the status keymap, the canvas cursor and the
	// host's own click routing — and inferring it here is how they would disagree.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribePendingStamp(setPendingStamp);
	}, [engineReady, host]);

	// The named history (D-11). The host publishes only when the log's two entry stacks
	// really moved — several paths tick the entity list without touching them — so this is
	// the whole mirror: a comparator here would have nothing left to catch, because the
	// push it would guard against is one the host does not make.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeHistory(setHistory);
	}, [engineReady, host]);

	// The advisor's findings. Pushed after every analyzer response and every
	// `setFlagFilters` (plus the current summary on subscribe). Answer-paced, not
	// frame-paced — which is why, unlike the stats mirror above, this needs no
	// value-equality guard.
	//
	// ANY push releases the in-flight verify, not just the one carrying its verdict: a
	// re-analysis that landed mid-verify may have replaced the row the key names, and
	// holding the column against a row that no longer exists would disable every Verify in
	// the list with no way back. (The refusal half of that release is the tool-error
	// effect above.)
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeFlags((summary) => {
			setFlags(summary);
			setVerifying(null);
		});
	}, [engineReady, host]);

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
	// hypothetical. This provider mounts once, with the shell. Remembering the set ACROSS
	// sessions is D-3's, and arrives with the palette.
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
	// the CHROME does, unconditionally. The restore lands in state, the push effect
	// above is keyed on that state, so the host is told what the user last chose. The
	// host's own retention is what keeps the two agreeing across a `loadWorld` — where
	// nothing here re-pushes — and never contradicts this, because a fresh host starts
	// on the same defaults these do.
	const filtersTouched = useRef(false);
	const filtersRestored = useRef(false);
	useEffect(() => {
		if (!store || filtersRestored.current) return;
		filtersRestored.current = true;
		if (filtersTouched.current) return;
		const stored = store.get("flagFilters");
		// A cold start keeps the state object it already has rather than adopting an
		// equal-valued new one: `deserializeFilters(undefined)` IS the defaults, and a
		// fresh identity would re-fire the push effect above for nothing.
		if (!stored) return;
		setFilters(deserializeFilters(stored));
	}, [store]);

	// Debounced by effect cleanup: each change cancels the previous pending write.
	useEffect(() => {
		if (!store || !filtersTouched.current) return;
		const timer = setTimeout(
			() => store.set("flagFilters", { ...filters }),
			PERSIST_DEBOUNCE_MS,
		);
		return () => clearTimeout(timer);
	}, [store, filters]);

	/** The ONE writer the chips call: records that the bands are now the user's, so
	 *  the restore above cannot land on top of a choice they have already made. */
	const editFilters = useCallback((next: FlagFilters): void => {
		filtersTouched.current = true;
		setFilters(next);
	}, []);

	const setTool = useCallback(
		(next: FieldTool): void => {
			setToolState(next);
			host?.setTool(next);
		},
		[host],
	);

	// Adopt + push inside the handler, NOT the filters effect above: this is the
	// pointer-rate half of that criterion (a slider drag pushes per frame, and the effect
	// form would cost a second render pass on every one of them), and it has no mount push
	// to fold in — the chrome's default IS the host's, so there is nothing to correct at
	// engine-ready. Adding one would be a new host call for no disagreement.
	const setRadius = useCallback(
		(r: number): void => {
			setRadiusState(r);
			host?.setDigRadius(r);
		},
		[host],
	);

	// Adopt + push, `setRadius`'s shape and for its reasons: click-rate, no mount push to
	// fold in (the chrome's default IS the host's), and no seam to mirror — the host
	// publishes no gesture, so nothing can push back.
	const setGesture = useCallback(
		(next: ViewportGesture | null): void => {
			setGestureState(next);
			host?.setGesture(next);
		},
		[host],
	);

	const verify = useCallback(
		(key: string): void => {
			setVerifying(key);
			host?.verifyFlag(key);
		},
		[host],
	);

	const value = useMemo<FieldHostState>(() => ({ stats }), [stats]);
	const entityValue = useMemo<FieldEntitiesState>(
		() => ({
			entities,
			drift,
			// Array → Set, and nothing else: the host decided the membership. Built
			// here rather than pushed as a Set so the seam stays plain JSON-shaped
			// data (every other host push is), and rebuilt only when the report
			// itself changes — which is what makes it safe to hand to a row lookup.
			driftedIds: new Set(drift?.entityIds ?? []),
		}),
		[entities, drift],
	);
	const entitySelectionValue = useMemo<FieldEntitySelectionState>(
		() => ({ selectedEntityId }),
		[selectedEntityId],
	);
	const toolValue = useMemo<FieldToolState>(
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
	const selectionValue = useMemo<FieldSelectionState>(
		() => ({ selection }),
		[selection],
	);
	const stampValue = useMemo<FieldStampState>(() => ({ stamp }), [stamp]);
	const segmentValue = useMemo<FieldSegmentHudState>(
		() => ({ segment }),
		[segment],
	);
	const historyValue = useMemo<FieldHistoryState>(
		() => ({ history }),
		[history],
	);
	const flagsValue = useMemo<FieldFlagsState>(
		() => ({ flags, filters, setFilters: editFilters, verifying, verify }),
		[flags, filters, editFilters, verifying, verify],
	);
	return (
		<FieldHostStateContext.Provider value={value}>
			<CameraPoseContext.Provider value={pose}>
				<FieldEntitiesContext.Provider value={entityValue}>
					<FieldEntitySelectionContext.Provider value={entitySelectionValue}>
						<FieldToolContext.Provider value={toolValue}>
							<FieldSelectionContext.Provider value={selectionValue}>
								<FieldStampContext.Provider value={stampValue}>
									<FieldSegmentHudContext.Provider value={segmentValue}>
										<FieldHistoryContext.Provider value={historyValue}>
											<FieldFlagsContext.Provider value={flagsValue}>
												{children}
											</FieldFlagsContext.Provider>
										</FieldHistoryContext.Provider>
									</FieldSegmentHudContext.Provider>
								</FieldStampContext.Provider>
							</FieldSelectionContext.Provider>
						</FieldToolContext.Provider>
					</FieldEntitySelectionContext.Provider>
				</FieldEntitiesContext.Provider>
			</CameraPoseContext.Provider>
		</FieldHostStateContext.Provider>
	);
}
