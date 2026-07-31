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
//   - a TOUCH is a COMMIT, never a preview. Every text-entry field in the form previews on
//     each keystroke (`NumberField` for unbounded params, `ExactNumberInput` inside the
//     slider and stepper for bounded ones), so promoting on preview would open (and cancel,
//     and re-open) a session per character — each firing a worker ghost — and would open it
//     on "1" while the user typed "12".
//   - the touch that promoted is APPLIED, not lost. `openEntity` opens the session on the
//     RECORD's params, so the edit is parked and pushed through `updateStamp` the moment
//     the session arrives — patched onto the SESSION's own params/seed/policy rather than
//     onto a chrome-side guess at what `openEntity` would produce. (The merge policy in
//     particular is not recoverable from the record: `GeneratorEntity` does not carry one.)
//   - it paints ONCE, and that took two mechanisms rather than one. `openEntity` sets the
//     session and publishes it synchronously (`openEntitySession` → `previewStamp` →
//     `notifyStamp`), so the touch and the session's ARRIVAL land in one React batch — the
//     rest state never paints with the edit missing. But the touch is APPLIED one render
//     later, from the effect below, and a passive effect runs after paint: React would
//     commit RECONFIGURE still holding the record's pre-touch value, so the value that
//     flickered would be the number the user just typed. Hence a LAYOUT effect — its body
//     only calls `host.updateStamp`, whose `notifyStamp` is synchronous, so React flushes
//     the resulting render before the browser paints either.
//   - a REFUSED promotion drops its touch. `openEntity` is runtime-quiet on an unknown id,
//     a frozen/baked entity and a retired generator; a parked edit that survived would land
//     on whatever session opened next — a different entity, silently carrying an edit made
//     to another one.
//
// The card owns NO lifecycle verb (D-14, user ruling): freeze, bake and delete are the
// entity ROW's, because they change what an entity IS rather than what it holds. What
// remains here is the recipe and the two verbs that end the session.
//
// WHAT LIVES IN `session-card/` and what stays here. This file owns the SELECTOR (which of
// the two sources is on screen), the promotion, and the two funnels every control writes
// through (`push` / `promoteThen`). The four pieces beside it — the seed row, the advanced
// disclosure, the read-only record and the footer — are presentational leaves that take
// values and callbacks and hold no host knowledge, which is exactly why they could move:
// each of them was a block of markup with one decision in it, and none of those decisions
// was about the card's state machine. `AdvancedSection` is the one exception and it says so
// in its own header: it remembers its disclosure across mounts, because this card does not
// survive its palette closing.
import type { MergePolicy } from "@furnace/core/field"; // type-only: erased
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	FieldEntityInfo,
	FieldGeneratorInfo,
	FieldHost,
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
import type { FieldRefusal } from "../../inspector/index.tsx";
import { SchemaForm } from "../../inspector/index.tsx";
import type { JsonSchemaNode } from "../../inspector/types.ts";
import { entityName } from "../../lib/actions.ts";
import { openBlockedReason } from "../../lib/field-entity.ts";
import {
	type SessionStateTag,
	sessionName,
	sessionStateTag,
} from "../../lib/field-session.ts";
import { humanizeLabel } from "../../lib/humanize.ts";
import { useEditor } from "../editor-context.ts";
import { AdvancedSection } from "./session-card/AdvancedSection.tsx";
import { ReadOnlyParams } from "./session-card/ReadOnlyParams.tsx";
import { SeedRow } from "./session-card/SeedRow.tsx";
import {
	SessionFooter,
	type SessionVerbs,
} from "./session-card/SessionFooter.tsx";

const PHASE_LABEL: Record<StampSession["phase"], string> = {
	configuring: "configuring",
	previewing: "previewing…",
	ready: "ready",
};

/** What ⏎ and Esc DO, per state. Three pairs rather than one, because the three states
 *  commit to different things and a footer that read "apply" over a grab would promise a
 *  reconfigure the host does not perform. */
const VERBS: Record<SessionStateTag, SessionVerbs> = {
	STAMP: { primary: "commit", secondary: "discard" },
	RECONFIGURE: { primary: "apply", secondary: "revert" },
	MOVE: { primary: "drop", secondary: "revert" },
};

/** The empty params record, hoisted so the fallback below is a STABLE identity — a `{}`
 *  literal in the expression would defeat the `formValues` memo it feeds. */
const NO_PARAMS: Record<string, unknown> = {};

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
	// The field the FORM is currently refusing, if any (D-25). It lives here rather than in
	// the form because the thing it disables — the commit verb — is the card's, and it
	// arrives as ONE refusal rather than a bag precisely so this card has nothing it could
	// print as a bottom-of-form dump.
	const [refusal, setRefusal] = useState<FieldRefusal | null>(null);
	// Stable, so `SchemaForm`'s report effect is driven by the refusal changing and not by
	// this card re-rendering (which it does on every session push).
	const onInvalid = useCallback((next: FieldRefusal | null) => {
		setRefusal(next);
	}, []);

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

	const params = stamp?.params ?? record?.params ?? NO_PARAMS;
	// SchemaForm re-seeds its drafts whenever `values` is a new ARRAY (`seed.current !==
	// values`), and a re-seed is a state write DURING render — so a fresh `[params]` literal
	// made every card render cost TWO SchemaForm renders, each rebuilding every field row,
	// and made `onBlurCapture`'s deferred re-seed fire unconditionally on every focus-out.
	//
	// MEASURED, both sides, 20 session pushes through the real Shell (and the number is not
	// the flattering one): with the host cloning the session as it actually does, this memo
	// changes nothing — 40 renders either way — because `structuredClone` in `notifyStamp`
	// hands the card a new `params` identity on every push, nudge and phase transition. Hold
	// that identity stable and the same 20 pushes cost 40 renders WITHOUT this memo and 21
	// with it. So the memo is the necessary half that lives in this file, and it is not the
	// sufficient one: the other half is a value-equality guard on the stamp seam, which is
	// the provider's call and is filed
	// (`docs/backlog/editor-and-tooling/stamp-seam-pushes-fresh-identities-per-frame.md`).
	//
	// ABOVE the early return, and that is not stylistic: as the first hook BELOW it this
	// crashed the card outright ("Rendered more hooks than during the previous render") the
	// moment the placeholder path rendered — which the burger-summon case reaches on purpose.
	const formValues = useMemo(() => [params], [params]);

	// The parked touch, applied to the session the promotion opened. ONE SHOT: cleared on
	// the first run whatever it finds, so a refusal (no session arrives) drops it rather
	// than leaving it for the next one. See `PendingTouch` for why that is the whole guard.
	//
	// A LAYOUT effect, for `useGenerators`' reason one notch sharper: a passive effect runs
	// after paint, so the browser would show the reconfigure holding the RECORD's pre-touch
	// value for a frame — and the value that flickers is the number the user just typed,
	// which is the worst thing on this card to flicker. The body only calls
	// `host.updateStamp`, which notifies synchronously, so the render it causes is flushed
	// before paint too.
	useLayoutEffect(() => {
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
		// Two ways here, and only one of them is momentary. (1) The subject just went away:
		// the driver closes the card in the next effect, and the registry read is a layout
		// effect, so nothing paints an empty form. (2) The user TICKED this palette in the
		// burger with nothing selected — `BurgerMenu` maps `PALETTE_IDS`, so the card has a
		// checkbox like every other palette (kept on purpose: it is the only exit from the
		// × latch). Through that route the placeholder STANDS until the next subject change,
		// which is why it is a sentence rather than a blank box. A retired generator id is
		// the third way, and it names itself.
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
	const seed = stamp?.seed ?? record?.seed ?? 0;
	const verbs = stamp === null ? null : VERBS[sessionStateTag(stamp)];
	const caveat = policyCaveat(stamp);
	const ready = stamp?.phase === "ready";
	// The refusal as one sentence, the field's own label first — "Chamber Radius must be
	// at most 8". `humanizeLabel` is the same spelling the form's own row caption uses, so
	// the name here and the name the user is looking at cannot drift.
	const refusalReason =
		refusal === null
			? undefined
			: `${humanizeLabel(refusal.path.split(".").at(-1) ?? refusal.path)} ${refusal.message}`;
	// A refusal outranks the settle gate: a refused param never previewed, so the ghost is
	// never going to settle on it, and "the preview must settle" would be true, useless,
	// and about the wrong thing.
	const commitBlockedReason =
		refusalReason ??
		(ready
			? undefined
			: `the ghost preview must settle before ${verbs?.primary}`);

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
				<ReadOnlyParams reason={blocked ?? ""} params={params} />
			) : (
				<>
					{/* Gated on core's own `usesSeed` declaration: a hall never reads its seed,
					    so a field and a ⚄ for it are two controls that do nothing. */}
					{def.usesSeed && (
						<SeedRow
							seed={seed}
							onSeed={(n) => push({ seed: n })}
							onReroll={() => promoteThen((h) => h.rerollStamp())}
						/>
					)}

					<div className="px-3 py-1">
						<SchemaForm
							// Boundary cast: the host surfaces paramSchema as an opaque plain-data
							// record (it cannot type it — the chrome can't value-import core); it IS
							// the generator's JSON-Schema object node, which is exactly SchemaForm's
							// structural input.
							schema={def.paramSchema as JsonSchemaNode}
							values={formValues}
							onPreview={(next) => {
								// Previews only reach a LIVE session: with none, there is no ghost to
								// preview against, and promoting per keystroke would open a session on
								// a half-typed number. See this file's header.
								if (stamp !== null)
									// Boundary cast: SchemaForm emits unknown[] drafts; draft 0 is this
									// subject's params record (values={formValues}).
									push({ params: next[0] as Record<string, unknown> });
							}}
							onCommit={(next) =>
								// Boundary cast: see onPreview.
								push({ params: next[0] as Record<string, unknown> })
							}
							onCancel={() => {
								/* nothing to revert — the ghost already shows the last applied params */
							}}
							onInvalid={onInvalid}
						/>
					</div>

					<AdvancedSection
						policy={stamp?.policy ?? "replace"}
						onPolicy={(policy) => push({ policy })}
						onNudge={(steps) => promoteThen((h) => h.nudgeStamp(...steps))}
					/>
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

			{/* The v0 caveats, stated once rather than left to surprise at Apply
			    (host.openEntity's contract owns both). It renders in REST as well as under a
			    reconfigure, and that is the whole point of `policyCaveat`: the merge select
			    reads "Replace" in REST because that is what a reconfigure WOULD open at, not
			    because the record says so — `GeneratorEntity` carries no policy at all. Shown
			    only under `reconfigure`, the rest state was stating a fact it does not have. */}
			{!readOnly && caveat !== null && (
				<p className="px-3 py-1 text-muted-foreground">{caveat}</p>
			)}
			{stamp?.truncatedSelection === true && (
				<p className="px-3 py-1 text-warning">
					the selection flood hit its budget — the stamp region under-covers it
				</p>
			)}

			{/* ABOVE the verbs, deliberately: a refusal printed under the button that
			    provoked it is read after the user has pressed it again.

			    TWO lines, not one, because the two refusals are different KINDS. The
			    session error is what the generator threw after evaluating — it reaches AT
			    (role="alert") because the only other signal is the ghost silently
			    vanishing. The field refusal is one the form made itself; SchemaForm has
			    already announced it at the field, so repeating it as a live region would
			    say it twice, and here it exists to explain the DISABLED VERB by naming the
			    field rather than leaving "invalid" to be hunted for. */}
			{stamp?.error != null && (
				<p role="alert" className="px-3 py-1 text-destructive">
					{stamp.error}
				</p>
			)}
			{refusalReason !== undefined && (
				<p className="px-3 py-1 text-destructive">{refusalReason}</p>
			)}

			{stamp !== null && verbs !== null && (
				<SessionFooter
					verbs={verbs}
					blockedReason={commitBlockedReason}
					onConfirm={() => fieldHostRef.current?.confirmSession()}
					onDiscard={() => fieldHostRef.current?.cancelStamp()}
				/>
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
	const { setDrivenOpen } = useWorkspaceActions();
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
			setDrivenOpen("session", false);
			return;
		}
		setDrivenOpen("session", true);
		// Unconditional, the ⚠ chip's rule: the card is very often already open and merely
		// buried, which has no open transition for the layer's safety net to catch.
		raise("session");
	}, [subject, setDrivenOpen, raise]);

	return null;
}

/** What the merge policy needs saying about it, or `null` when nothing does.
 *
 *  `GeneratorEntity` records no merge policy, so "Replace" is never a fact READ off a
 *  committed stamp — in REST it is a prediction about what a reconfigure would open at, and
 *  under a live reconfigure it is what the ghost is actually running. Both need saying and
 *  they do not say the same thing; a CREATE session needs neither, because the policy there
 *  is simply the one the user picked. */
function policyCaveat(stamp: StampSession | null): string | null {
	if (stamp === null)
		return "merge policy isn't recorded — a reconfigure opens at Replace whatever this stamp was committed with";
	if (stamp.mode === "reconfigure")
		return "merge policy isn't recorded — this opens at Replace; the ghost previews against the current field, Apply rewinds this stamp's chunks first";
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
