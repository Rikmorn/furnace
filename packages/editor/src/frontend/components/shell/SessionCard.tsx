// THE SESSION CARD (D-13) — the editor's properties surface, and the successor to both
// the F2b stamp inspector and the whole Inspector concept the dock era carried.
//
// It has THREE states over ONE control set, and the state is decided by two host facts
// alone (is there a session, is an entity selected) rather than by anything it remembers:
//
//   CREATE       a `stamp` session. About a REGION — there is no entity yet — so ⏎ commits.
//   REST         an entity is selected and nothing is armed. The values come off the
//                committed RECORD, no ghost is previewing, and the first control the user
//                COMMITS through promotes the card into a reconfigure carrying that edit.
//   RECONFIGURE  a `reconfigure` session (a MOVE is one of these, flagged). The values come
//                off the SESSION, the ghost previews live, ⏎ applies.
//
// TWO SOURCES, ONE SELECTOR. Rest reads the record; reconfigure reads the session; the card
// PICKS one on `stamp !== null` and never merges them. That rule is the whole answer to
// "how do they stay in agreement" — they do not have to, because only one is on screen at a
// time, and during a live session the record deliberately still holds the committed values
// (it does until Apply lands). A card that blended them would show a number no surface
// anywhere is about to build.
//
// THE PROMOTION is the subtlest thing here, so it is stated in full:
//   - a TOUCH is a COMMIT, never a preview. `NumberField` previews on every keystroke, so
//     promoting on preview would open (and cancel, and re-open) a session per character —
//     each firing a worker ghost — and would open it on "1" while the user typed "12".
//   - the touch that promoted is APPLIED, not lost. `openEntity` opens the session on the
//     RECORD's params, so the edit is parked and pushed through `updateStamp` the moment
//     the session arrives — patched onto the SESSION's own params/seed/policy rather than
//     onto a chrome-side guess at what `openEntity` would produce. (The merge policy in
//     particular is not recoverable from the record: `GeneratorEntity` does not carry one.)
//   - between the touch and the session there is one render. `openEntity` sets the session
//     and pushes it synchronously, so the two land in one React batch and nothing paints in
//     between.
//   - a REFUSED promotion drops its touch. `openEntity` is runtime-quiet on an unknown id,
//     a frozen/baked entity and a retired generator; a parked edit that survived would land
//     on whatever session opened next — a different entity, silently carrying an edit made
//     to another one.
//
// The card owns NO lifecycle verb (D-14, user ruling): freeze, bake and delete are the
// entity ROW's, because they change what an entity IS rather than what it holds. What
// remains here is the recipe and the two verbs that end the session.
import type { MergePolicy } from "@furnace/core/field"; // type-only: erased
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
	FieldEntityInfo,
	FieldGeneratorInfo,
	FieldHost,
	NudgeSteps,
	StampSession,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { useCatalog } from "../../hooks/useCatalogs.tsx";
import {
	useFieldEntities,
	useFieldEntitySelection,
	useFieldStamp,
} from "../../hooks/useFieldHostState.tsx";
import { usePaletteRaise } from "../../hooks/usePaletteStack.tsx";
import { useWorkspaceActions } from "../../hooks/useWorkspace.tsx";
import { SchemaForm } from "../../inspector/index.tsx";
import type { JsonSchemaNode } from "../../inspector/types.ts";
import { entityName } from "../../lib/actions.ts";
import { formatParam, openBlockedReason } from "../../lib/field-entity.ts";
import {
	type SessionStateTag,
	sessionName,
	sessionStateTag,
} from "../../lib/field-session.ts";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { useEditor } from "../editor-context.ts";
import { ReasonTip, SELECT_CLASS } from "../field/form-bits.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

const LABEL_CLASS = "flex items-center gap-1.5 text-muted-foreground";

const POLICIES: { value: MergePolicy; label: string }[] = [
	{ value: "replace", label: "Replace" },
	{ value: "keep-existing-air", label: "Keep existing air" },
];

/** Decode the `<select>` value back to a policy. Values come from our own option set, so
 *  anything unrecognised (impossible) falls back to replace. */
const parsePolicy = (v: string): MergePolicy =>
	v === "keep-existing-air" ? v : "replace";

const PHASE_LABEL: Record<StampSession["phase"], string> = {
	configuring: "configuring",
	previewing: "previewing…",
	ready: "ready",
};

/** What ⏎ and Esc DO, per state. Three pairs rather than one, because the three states
 *  commit to different things and a footer that read "apply" over a grab would promise a
 *  reconfigure the host does not perform. */
const VERBS: Record<SessionStateTag, { primary: string; secondary: string }> = {
	STAMP: { primary: "commit", secondary: "discard" },
	RECONFIGURE: { primary: "apply", secondary: "revert" },
	MOVE: { primary: "drop", secondary: "revert" },
};

// The placement nudges as axis PAIRS, so the cluster reads as three axes rather than six
// loose buttons. The steps and their key twins mirror `arrowNudgeSteps` (input-map.ts),
// which is the canonical binding — these are its button labels, not a second source.
const NUDGE_AXES: {
	axis: string;
	minus: { steps: NudgeSteps; key: string };
	plus: { steps: NudgeSteps; key: string };
}[] = [
	{
		axis: "X",
		minus: { steps: [-1, 0, 0], key: "←" },
		plus: { steps: [1, 0, 0], key: "→" },
	},
	{
		axis: "Y",
		minus: { steps: [0, -1, 0], key: "⇧↓" },
		plus: { steps: [0, 1, 0], key: "⇧↑" },
	},
	{
		axis: "Z",
		minus: { steps: [0, 0, -1], key: "↑" },
		plus: { steps: [0, 0, 1], key: "↓" },
	},
];

// 24px, below the card's 32px (size="sm") norm: six of these sit in ONE row as a compact
// d-pad, and at 32px they read as six peers of the commit verb rather than one cluster.
const NUDGE_BUTTON_CLASS = "h-6 px-2 font-mono";

/** One update to a live session, as a PATCH: the fields the card is changing, with the
 *  session supplying the rest. A patch rather than the seam's three positional arguments
 *  because a promotion has to carry the change across a render — and at the moment it is
 *  recorded there is no session to read the other two off. */
type SessionPatch = {
	params?: Record<string, unknown>;
	seed?: number;
	policy?: MergePolicy;
};

/** A touch parked across the promotion.
 *
 *  Deliberately NOT carrying the entity id it was made on, and the reason is worth stating
 *  because the id looks like an obvious guard. `openEntity` has exactly two outcomes and
 *  both are SYNCHRONOUS: it opens the session for that entity (`openEntitySession` sets it
 *  and `previewStamp` publishes it before returning), or it refuses and opens nothing. So
 *  the session the effect below sees in the very next commit is either the one this touch
 *  was made for or none at all — an id check has no third case to catch, and a guard that
 *  cannot fire reads as coverage while providing none. What actually addresses the touch is
 *  the ONE-SHOT: it is consumed on the first effect run whatever it finds, so a refusal
 *  drops it rather than leaving it for whatever opens next. */
type PendingTouch = { patch: SessionPatch };

/** The registry's generators, re-read whenever the entity catalog lands.
 *
 *  A LAYOUT effect for the first read, unlike the panel this came from: the card is
 *  unmounted whenever its palette is closed, so its mount happens in the same commit that
 *  opens it — and a passive effect would paint one frame of a card that cannot resolve its
 *  own schema. The tick read stays passive; the catalog is async by construction and its
 *  arrival is never in the same commit as anything the user did. */
function useGenerators(): FieldGeneratorInfo[] {
	const { state, fieldHostRef } = useEditor();
	const { entityCatalogTick } = useCatalog();
	const [generators, setGenerators] = useState<FieldGeneratorInfo[]>([]);
	const ready = state.status === "ready";

	useLayoutEffect(() => {
		const host = fieldHostRef.current;
		if (!host || !ready) return;
		setGenerators(host.listGenerators());
	}, [ready, fieldHostRef]);

	// `listGenerators()` is a SNAPSHOT: an archetype-driven generator's `archetypeId` param
	// only carries its picker options once the host HOLDS the entity catalog, and that
	// catalog arrives off an async fetch. A card that read the registry once renders a
	// free-text field forever. The zero guard keeps this from re-reading at mount.
	useEffect(() => {
		if (entityCatalogTick === 0) return;
		const host = fieldHostRef.current;
		if (!host) return;
		setGenerators(host.listGenerators());
	}, [entityCatalogTick, fieldHostRef]);

	return generators;
}

export function SessionCard() {
	const { fieldHostRef } = useEditor();
	const { stamp } = useFieldStamp();
	const { entities } = useFieldEntities();
	const { selectedEntityId } = useFieldEntitySelection();
	const generators = useGenerators();
	const [pending, setPending] = useState<PendingTouch | null>(null);

	// The record behind the REST state. Read out of the entity list rather than held,
	// so a freeze, a ⌘Z or a reconfigure elsewhere reaches this card by the same tick
	// that reaches the rows.
	const record =
		selectedEntityId === null
			? undefined
			: entities.find((e) => e.entityId === selectedEntityId);

	// THE SELECTOR (see this file's header): a session wins over the record, always.
	const generatorId = stamp?.generator ?? record?.generator;
	const def = generators.find((g) => g.id === generatorId);

	// The parked touch, applied to the session the promotion opened. ONE SHOT: cleared on
	// the first run whatever it finds, so a refusal (no session arrives) drops it rather
	// than leaving it for the next one. See `PendingTouch` for why that is the whole guard.
	useEffect(() => {
		if (pending === null) return;
		setPending(null);
		if (stamp === null) return;
		fieldHostRef.current?.updateStamp(
			pending.patch.params ?? stamp.params,
			pending.patch.seed ?? stamp.seed,
			pending.patch.policy ?? stamp.policy,
		);
	}, [pending, stamp, fieldHostRef]);

	if (def === undefined || (stamp === null && record === undefined))
		// One frame, at most: the driver closes the card when its subject goes away, and the
		// registry read is a layout effect. A retired generator id is the only lasting way
		// here, and it says so rather than rendering an empty box.
		return (
			<p className="p-3 text-xs text-muted-foreground">
				{generatorId === undefined
					? "nothing selected"
					: `${generatorId} is no longer in the generator registry`}
			</p>
		);

	// Frozen and baked records are READ-ONLY here, the entities row's rule: `openEntity`
	// refuses them, so live controls would be a form whose every edit reported a refusal.
	const blocked = record === undefined ? null : openBlockedReason(record);
	const readOnly = stamp === null && blocked !== null;

	/** Push a change at the live session, or PROMOTE the rest state into one carrying it. */
	const push = (patch: SessionPatch): void => {
		const host = fieldHostRef.current;
		if (!host) return;
		if (stamp !== null) {
			host.updateStamp(
				patch.params ?? stamp.params,
				patch.seed ?? stamp.seed,
				patch.policy ?? stamp.policy,
			);
			return;
		}
		if (record === undefined || blocked !== null) return;
		host.openEntity(record.entityId);
		setPending({ patch });
	};

	/** Promote (if needed) and run a session verb that needs no session VALUES — the host
	 *  opens the session synchronously inside `openEntity`, so the verb lands on it. The
	 *  parked-touch machinery above exists only for `updateStamp`, which needs the seed and
	 *  policy the session decides. */
	const promoteThen = (verb: (host: FieldHost) => void): void => {
		const host = fieldHostRef.current;
		if (!host) return;
		if (stamp === null) {
			if (record === undefined || blocked !== null) return;
			host.openEntity(record.entityId);
		}
		verb(host);
	};

	// SELECTED is not a session state — it is the ABSENCE of one — which is why it is spelled
	// here rather than added to `SessionStateTag`: the union's job is to force a ⏎/Esc verb
	// pair for every state that HAS one, and rest has neither.
	const tag = stamp === null ? "SELECTED" : sessionStateTag(stamp);
	const name = subjectName(stamp, record);
	const params = stamp?.params ?? record?.params ?? {};
	const seed = stamp?.seed ?? record?.seed ?? 0;
	const verbs = stamp === null ? null : VERBS[sessionStateTag(stamp)];
	const ready = stamp?.phase === "ready";

	return (
		<div className="flex flex-col text-xs">
			{/* The head, the mock's own row: glyph, name, state tag. The palette's chrome
			    header above it carries the PALETTE's name ("Session") because that string is
			    also the burger menu's item and the close button's accessible name — making it
			    follow the selection would rename a menu entry per click. */}
			<div className="flex items-center gap-2 border-border/50 border-b px-3 py-2">
				<span aria-hidden="true" className="text-muted-foreground">
					▤
				</span>
				<span className="min-w-0 flex-1 truncate font-mono">{name}</span>
				<span className="font-semibold text-[10px] text-primary tracking-widest">
					{tag}
				</span>
			</div>

			{readOnly ? (
				// The record, as the entity row shows it. No form: every control here would
				// report a refusal, and a live-looking dead control is the failure D-7 exists
				// to retire.
				<div className="px-3 py-2">
					<p className="pb-1 text-muted-foreground">{blocked}</p>
					<dl className="grid grid-cols-[auto_1fr] gap-x-3">
						{Object.entries(params).map(([k, v]) => (
							<Fragment key={k}>
								<dt className="font-mono text-muted-foreground">{k}</dt>
								{/* The ROW's renderer, not `String`: one spelling of "how a committed
								    param reads", so the frozen card and the expanded entity row cannot
								    show the same record differently (`String` on an object param would
								    print "[object Object]" here and JSON there). */}
								<dd className="tabular-nums">{formatParam(v)}</dd>
							</Fragment>
						))}
					</dl>
				</div>
			) : (
				<>
					{/* The seed row, gated on core's own `usesSeed` declaration: a hall never
					    reads its seed, so a field and a ⚄ for it are two controls that do
					    nothing when pressed. */}
					{def.usesSeed && (
						<div className="flex items-center gap-2 px-3 py-1.5">
							{/* biome-ignore lint/a11y/noLabelWithoutControl: the label wraps its control as children (shadcn Input); Biome cannot trace the native control across the component boundary — getByLabelText still resolves it */}
							<label className={`${LABEL_CLASS} w-[52px]`}>seed</label>
							<Input
								type="number"
								min={0}
								step={1}
								value={seed}
								onChange={(e) => {
									// An empty field is MID-EDIT, not a commit: Number("") is 0, so
									// without this guard clearing the field would stamp seed 0.
									if (e.target.value === "") return;
									const n = Number(e.target.value);
									if (Number.isInteger(n) && n >= 0) push({ seed: n });
								}}
								onBlur={(e) => {
									// Settled-display re-sync (the hollow blur-clamp pattern): a
									// cleared/rejected value never commits, so the DOM can end up
									// diverged — snap it back once typing settles.
									e.target.value = String(seed);
								}}
								aria-label="stamp seed"
								className="h-7 w-20 font-mono"
							/>
							<Button
								type="button"
								size="sm"
								variant="secondary"
								className="ml-auto h-7"
								title="re-roll the seed"
								aria-label="re-roll seed"
								onClick={() => promoteThen((h) => h.rerollStamp())}
							>
								⚄
							</Button>
						</div>
					)}

					<div className="px-3 py-1">
						<SchemaForm
							// Boundary cast: the host surfaces paramSchema as an opaque plain-data
							// record (it cannot type it — the chrome can't value-import core); it IS
							// the generator's JSON-Schema object node, which is exactly SchemaForm's
							// structural input.
							schema={def.paramSchema as JsonSchemaNode}
							values={[params]}
							onPreview={(next) => {
								// Previews only reach a LIVE session: with none, there is no ghost to
								// preview against, and promoting per keystroke would open a session on
								// a half-typed number. See this file's header.
								if (stamp !== null)
									// Boundary cast: SchemaForm emits unknown[] drafts; draft 0 is this
									// subject's params record (values={[params]}).
									push({ params: next[0] as Record<string, unknown> });
							}}
							onCommit={(next) =>
								// Boundary cast: see onPreview.
								push({ params: next[0] as Record<string, unknown> })
							}
							onCancel={() => {
								/* nothing to revert — the ghost already shows the last applied params */
							}}
						/>
					</div>

					{/* The session MECHANICS, behind the mock's `▸ advanced`: where the stamp
					    sits and how it merges are not recipe values, and a card that leads with
					    them buries the params the user came for. Collapsed by default. */}
					<div className="px-3 py-1">
						<CollapsibleSection title="advanced" defaultOpen={false}>
							<div className="flex flex-col gap-2 pb-1">
								<label className={LABEL_CLASS}>
									merge
									<select
										value={stamp?.policy ?? "replace"}
										onChange={(e) =>
											push({ policy: parsePolicy(e.target.value) })
										}
										aria-label="merge policy"
										className={`${SELECT_CLASS} h-7`}
									>
										{POLICIES.map((p) => (
											<option key={p.value} value={p.value}>
												{p.label}
											</option>
										))}
									</select>
								</label>
								{/* Placement: the region moves, the params don't — one 0.5 m lattice
								    step per press, both corners, so the size never changes. */}
								{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
								<div
									className="flex flex-wrap items-center gap-2"
									role="group"
									aria-label="nudge the stamp region"
								>
									<span className={LABEL_CLASS}>nudge</span>
									{NUDGE_AXES.map(({ axis, minus, plus }) => (
										<span key={axis} className="flex items-center gap-1">
											<Button
												type="button"
												size="sm"
												variant="secondary"
												className={NUDGE_BUTTON_CLASS}
												title={`move the region 0.5 m along −${axis} (${minus.key} in the viewport)`}
												aria-label={`nudge minus ${axis}`}
												onClick={() =>
													promoteThen((h) => h.nudgeStamp(...minus.steps))
												}
											>
												−{axis}
											</Button>
											<Button
												type="button"
												size="sm"
												variant="secondary"
												className={NUDGE_BUTTON_CLASS}
												title={`move the region 0.5 m along +${axis} (${plus.key} in the viewport)`}
												aria-label={`nudge plus ${axis}`}
												onClick={() =>
													promoteThen((h) => h.nudgeStamp(...plus.steps))
												}
											>
												+{axis}
											</Button>
										</span>
									))}
									<span className="text-[10px] text-muted-foreground">
										in the viewport: ←/→ move X, ↑/↓ move Z, ⇧↑/⇧↓ move Y
									</span>
								</div>
							</div>
						</CollapsibleSection>
					</div>
				</>
			)}

			{stamp !== null && (
				<p className="px-3 py-1 text-muted-foreground">
					{PHASE_LABEL[stamp.phase]}
					{stamp.opCount !== null && (
						<span className="tabular-nums"> · {stamp.opCount} ops</span>
					)}
					{/* Props are the ONLY output an archetype-driven generator (scatter) has —
					    its op count is always 0 — so its count shows whenever a preview has
					    settled, INCLUDING at zero: "0 ops · 0 props" is the reading the host's
					    commit refusal then explains. A carver has no props by construction. */}
					{def.placesProps && stamp.placementCount !== null && (
						<span className="tabular-nums">
							{" "}
							· {stamp.placementCount} props
						</span>
					)}
				</p>
			)}

			{/* The two v0 caveats a reconfigure carries, stated once rather than left to
			    surprise at Apply (host.openEntity's contract owns both): the merge policy is
			    not recorded provenance, and the ghost is previewed against the field as it
			    stands now while Apply rewinds this stamp's chunks first. */}
			{stamp?.mode === "reconfigure" && (
				<p className="px-3 py-1 text-muted-foreground">
					merge policy isn't recorded — this opens at Replace; the ghost
					previews against the current field, Apply rewinds this stamp's chunks
					first
				</p>
			)}
			{stamp?.truncatedSelection === true && (
				<p className="px-3 py-1 text-warning">
					the selection flood hit its budget — the stamp region under-covers it
				</p>
			)}

			{/* ABOVE the verbs, deliberately: a refusal printed under the button that
			    provoked it is read after the user has pressed it again. Task 11 gives it the
			    field-level treatment D-25 asks for; until then it is one line in the one
			    place a reader looks before committing. role="alert" because a failed evaluate
			    must reach screen readers — the ghost silently vanishing is the only other
			    signal. */}
			{stamp?.error != null && (
				<p role="alert" className="px-3 py-1 text-destructive">
					{stamp.error}
				</p>
			)}

			{stamp !== null && verbs !== null && (
				<div className="flex gap-2 border-t border-border px-3 py-2">
					{/* ReasonTip, not a bare title: a disabled Button's pointer-events-none
					    would swallow the tooltip explaining the ready gate. */}
					<ReasonTip
						reason={
							ready
								? undefined
								: `the ghost preview must settle before ${verbs.primary}`
						}
						className="flex-1"
					>
						<Button
							type="button"
							size="sm"
							className="w-full"
							disabled={!ready}
							// The KEY is in the accessible name because the glyph is what the user
							// reads and "⏎" is not a word. The house pattern (EntitiesList's
							// RowVerb): the pictograph is decorative, the label is the name.
							aria-label={`${verbs.primary} (Enter)`}
							onClick={() => fieldHostRef.current?.confirmSession()}
						>
							<span aria-hidden="true">⏎</span> {verbs.primary}
						</Button>
					</ReasonTip>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						className="flex-1"
						aria-label={`${verbs.secondary} (Esc)`}
						// `cancelStamp`, not `escape`. The Esc LADDER's first rung is a half-drawn
						// box/segment corner, and one CAN stand beside a session (`selectionClick`
						// is not suspended by `suspendedByStamp`, only the stroke and the segment
						// are) — so routing this button through the ladder would sometimes drop an
						// anchor and leave the session standing under a button that says "revert".
						// The KEY still runs the ladder; this button does what it says.
						onClick={() => fieldHostRef.current?.cancelStamp()}
					>
						<span aria-hidden="true">esc</span> {verbs.secondary}
					</Button>
				</div>
			)}

			{stamp === null && !readOnly && (
				// No verbs in REST, and a disabled pair would be worse than none: it advertises
				// a state the user cannot reach from here, when the way in is simply to edit
				// something.
				<p className="border-t border-border px-3 py-2 text-muted-foreground">
					edit any value to open a session on this stamp
				</p>
			)}
		</div>
	);
}

/** The card's OPEN state, driven (D-13). It is a component rather than an effect inside the
 *  card because the card only exists while the palette is open — the thing that opens it
 *  cannot live inside it.
 *
 *  Keyed on the SUBJECT, not on the open flag, and that is the whole of the "is this
 *  annoying?" answer. Closing the card with its × is a statement about the thing you were
 *  looking at, so the same subject pushed again (an entity tick, a preview settling) leaves
 *  it closed; a DIFFERENT subject is a new question and the card answers it. It cannot be a
 *  latch either way round: the card is the only properties surface, so a dismissal that
 *  outlived its subject would leave `openEntity` with nowhere to render.
 *
 *  It reads no arrangement state on purpose. `setOpen` marks the workspace as
 *  user-arranged, which SKIPS the restore that has not happened yet — so a driver that
 *  wrote at mount would silently discard the persisted arrangement on every boot. The
 *  subject guard is what makes the mount case a no-op: with nothing selected the first
 *  subject IS the initial one, and nothing is written. */
export function SessionCardPresence() {
	const { stamp } = useFieldStamp();
	const { selectedEntityId } = useFieldEntitySelection();
	const { setOpen } = useWorkspaceActions();
	const raise = usePaletteRaise();
	// The last subject ACTED ON. A ref, not state, and the difference is not cosmetic: as
	// state it would be an effect dependency, so writing it would schedule a second run of
	// this very effect — one that re-asserts `setOpen` and `raise` for a subject nothing
	// changed about. A ref makes the effect run exactly once per subject change.
	const shown = useRef<string | null>(null);

	// What the card would be ABOUT. A string, so "the same entity, pushed again" and "a
	// different entity" are one comparison — and so a rest state promoting into a session
	// on the same entity counts as a new subject (the card is necessarily open by then, so
	// the re-open is a no-op and the raise is free).
	const subject = subjectKey(stamp, selectedEntityId);

	useEffect(() => {
		// The MOUNT case is the load-bearing one, and it is a claim about persistence rather
		// than about the card: with nothing selected the first subject IS the initial one, so
		// nothing is written. Any write here would go through `setOpen` → the workspace
		// provider's `edit`, which marks the arrangement "the user's" and SKIPS the restore
		// it has not performed yet — and this component's effects run BEFORE the provider's
		// (React runs children first), so a driver that wrote at mount would silently discard
		// the persisted arrangement on every boot.
		if (subject === shown.current) return;
		shown.current = subject;
		if (subject === null) {
			setOpen("session", false);
			return;
		}
		setOpen("session", true);
		// Unconditional, the ⚠ chip's rule: the card is very often already open and merely
		// buried, which has no open transition for the layer's safety net to catch.
		raise("session");
	}, [subject, setOpen, raise]);

	return null;
}

/** What the card's subject is CALLED. `entityName` is the rows' and the menu labels'
 *  spelling and `sessionName` is the strip's, so all four surfaces name one object one way.
 *  Total by construction: the card returns early when it has neither. */
function subjectName(
	stamp: StampSession | null,
	record: FieldEntityInfo | undefined,
): string {
	if (stamp !== null) return sessionName(stamp);
	return record === undefined ? "" : entityName(record);
}

/** What the card is about, as one comparable value — `null` when it is about nothing. */
function subjectKey(
	stamp: StampSession | null,
	selectedEntityId: number | null,
): string | null {
	if (stamp !== null)
		return `session:${stamp.generator}:${stamp.entityId ?? "new"}`;
	return selectedEntityId === null ? null : `entity:${selectedEntityId}`;
}
