// The committed-entities list: one row per generator entity in log order, fed
// by the shell provider's host.listEntities() mirror (F4.5a Task 10 — it used to
// be the panel's). Clicking a row SELECTS its entity and expands an inline
// READ-ONLY params <dl>; clicking again collapses it and leaves the selection
// standing. F3a added the smart-object verbs beside it: Open starts a
// reconfigure session (the same staged form a fresh stamp gets), then
// freeze/unfreeze and sever. The <dl> stays read-only — it is the record, not
// the editor; Open is how a row becomes editable, which is also why a FROZEN or
// BAKED row keeps its params visible while its Open is disabled.
//
// F3b adds nothing but a segment: a scatter is an ordinary generator entity, so
// its row already had every verb and the generic params <dl>. What it lacked was
// the one fact the rest of the row's summary could not carry — a scatter writes
// no cells, so "1 ops" says nothing about what it put down. `placed` (host-
// derived, see rowSummary) names the archetype and the count.
//
// F4.5b Task 4 makes this the LAYERS panel (D-14) rather than a read-out:
//   - the row is one half of a BIDIRECTIONAL selection sync. Clicking it calls
//     the host's `selectEntity`, which is the same state a `pointer` click in
//     the viewport writes; the id coming back down `subscribeEntitySelection`
//     styles the row and scrolls it into view. One selection concept, two
//     surfaces — which is also how expanding a row got its viewport box back
//     after `highlightEntity` was retired (Task 3): the box follows SELECTION
//     now, and selection is what a row click writes.
//   - 🗑 delete joins the row, and sever adopts the mock's ⬇ bake glyph.
//   - a Δ badge appears on any row the standing drift report touches, and is a
//     POINTER to the report rather than a copy of it — the DriftReport section
//     stays where it is, and the badge scrolls it into view.
//
// THE ROW VERBS ARE SVG GLYPHS (lucide), and the F4.5 holistic gate is what settled it.
// FIVE bare emoji shipped here — ⬇ sever, 🗑 delete, ❄ freeze, 🔓 unfreeze and 🔒 on the
// badge — and the two destructive ones carried no tone: the class was deleted rather than
// moved when the worded verbs became pictographs, and the comment that stood here deferred
// the real answer to a design decision instead of guessing. That decision is taken. A
// lucide icon is `currentColor` SVG, so the destructive pair takes `--destructive-text`
// exactly as the WORDED verbs used to — see `DESTRUCTIVE_VERB_CLASS` below for the class
// string, why it is a pair, and what the emoji actually did (spelled ONCE, there).
//
// D-23's three state rules are ui/button.tsx's and are not re-decided here. Pinned from
// BOTH sides in tests/chrome/entities-palette.test.tsx: the destructive pair carries the
// tone, the neutral pair must not, and each verb's glyph is asserted BY IDENTITY (the
// `lucide-*` class lucide stamps on the svg) — which is what stops the sever arrow
// quietly becoming a `Copy`.
//
// `▦` (U+25A6) and the view chip's `⬒` (U+2B12) STAY, and the line is measured rather
// than preferred: neither carries a Unicode emoji property, and both were checked on this
// chrome's own stack to take `color` as they stand. The five that moved are the five that
// carry one.
//
// Verb spelling, from the spec rather than from the shape of the code: D-14 maps the
// row's glyph trio as freeze ❄ / BAKE ⬇ / delete 🗑, and the mock's own caption says
// those three "stay on the row". So the DOWN ARROW is D-14's bake glyph — NOT duplicate —
// carrying the verb this UI calls SEVER, and DUPLICATE IS NOT A ROW VERB AT ALL: the mock
// puts it in the burger (`Duplicate "maze-3"`), which is why there is no
// arrow-for-duplicate button below however naturally the glyph reads as one. The icon
// swap had to keep that reading intact, and `ArrowDownToLine` is chosen for exactly it:
// it is the flatten / bake-down shape, an arrow landing on a baseline, and it shares
// nothing with lucide's `Copy` — two offset rectangles — which is the glyph duplicate
// would take if it ever earned one.
//
// `FieldHost.duplicateEntity` exists and is tested; it is deliberately menu-only,
// and F4.5b Task 7 gives it its binding — ⌘J plus an Edit-menu item (the
// charter's §5 ruling, superseding the mock's ⌘D, which Safari owns as
// bookmark-this-page). INTERIM GAP, stated the way Task 3 stated its Select-button
// stopgap: between this task and Task 7 the verb is reachable from tests and from
// nothing else. That is a gap in reach, not in behaviour.
//
// "Open" is now a SECOND way into a surface that opens by itself, and this is the
// state of that question rather than a defence of it. Since F4.5b Task 10 a row
// click selects, the session card auto-opens in its REST state, and the first
// control the user commits through promotes it into the reconfigure this button
// opens directly — so what the button still buys is a ghost with no edit in it.
// It stays for now because retiring it is a decision about the ROW's composition
// (which verbs live here at all, whether a ⋯ menu earns its click) rather than a
// line to delete, and that is the pass this comment has always deferred to. It is
// the first candidate on it. (The original reason for inline buttons — Radix menus
// not rendering under this package's happy-dom harness — is no longer true: the
// burger menu is asserted through its content in tests/chrome/shell.test.tsx,
// once `_register.ts` is imported FIRST so Radix resolves `globalThis.document`
// at module-evaluation time.)
//
// a11y convention for the row: the four ACTION buttons all carry an aria-label
// naming their verb AND the entity id, because what they show ("Open", then three
// `aria-hidden` icons) repeats identically on every row — a screen-reader user choosing
// between eight identically-named buttons cannot tell which stamp they are about to
// sever. Every one of them also carries its DISABLED REASON in that label when it
// has one, because the wrapper `title` a disabled button needs (it swallows
// pointer events) sits on a non-focusable span that reaches neither a screen
// reader reliably nor a keyboard user at all. The expand button is the exception
// and needs no label: its visible text already names the stamp it belongs to.
//
// F4.5c Task 8 closes the other half of that (D-25): while a verb is AVAILABLE its
// sentence is a real Radix tooltip, which opens on FOCUS as well as hover — so the
// documentation on the three verbs that CHANGE the stamp is no longer mouse-only. The
// keycap on delete is READ off the action registry rather than written here, and
// only on the selected row, because that is the only row ⌫ would act on.
//
// F4.5c Task 9 closes the LAST of it (D-26). Every one of the controls above used to be
// its own tab stop — ~6N tabs to reach the last row of an N-entity world, and no way to
// move DOWN the list at all, because Tab walks a row and never crosses one. The list is
// now ONE tab stop: see the grid's own header below for which APG pattern it is and why
// that one.
import type { LucideIcon } from "lucide-react";
import {
	ArrowDownToLine,
	Lock,
	LockOpen,
	Snowflake,
	Trash2,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
// The committed-entity policy vocabulary: one blocked-reason rule per row verb,
// plus the param renderer the provider's push guard also compares through. A
// chrome-side lib module on purpose (see its header): the host imports it, never
// the reverse.
import {
	bakeBlockedReason,
	deleteBlockedReason,
	formatParam,
	freezeBlockedReason,
	openBlockedReason,
} from "../../../shared/field-entity.ts";
import type { FieldEntityInfo } from "../../../viewport-host/index.ts"; // type-only: erased
import {
	Grid,
	GridCell,
	GridRow,
	useRowGrid,
} from "../../hooks/useRovingList.tsx";
import { cn } from "../../lib/cn.ts";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { Button } from "../ui/button.tsx";
import { ActionTip, ReasonTip } from "../ui/tips.tsx";

/** `opSpan` is [firstOpId, lastOpId] inclusive (commitGenerator). */
const opCount = (e: FieldEntityInfo): number => e.opSpan[1] - e.opSpan[0] + 1;

/** The row's one-line record, `·`-joined: the recipe (generator, seed, span
 *  size) plus, for a stamp that PLACED something, each archetype it placed and
 *  how many — `scatter · seed 3 · 1 ops · rock · 24 placed`.
 *
 *  Deliberately NOT the session CARD's zero-rule, which it otherwise resembles.
 *  That one gates on the GENERATOR (`def.placesProps`) and so shows "· 0 props"
 *  at zero, because a settled preview at zero is the state whose commit refusal
 *  it is about to explain. A committed row has no such state to explain, and no
 *  per-entity `placesProps` to gate on — the chrome sees records, not schemas —
 *  so it gates on the records and shows nothing. Consequence, stated because it
 *  is a real (if unreachable) gap: a LOADED world holding a placer that placed
 *  zero would read like a carver. The host refuses to commit one, so only a
 *  hand-written oplog can produce it. */
const rowSummary = (e: FieldEntityInfo): string =>
	[
		e.generator,
		`seed ${e.seed}`,
		`${opCount(e)} ops`,
		...e.placed.flatMap((p) => [p.archetypeId, `${p.count} placed`]),
	].join(" · ");

const ROW_BUTTON_CLASS = "h-5 px-1.5 text-xs";

/** D-23's destructive lane on an icon-only `ghost` verb, spelled ONCE so the two verbs in
 *  it cannot drift apart the way the bare-glyph pair did.
 *
 *  `text-destructive-text`, never `text-destructive`: the fill measures 3.26:1 on `--card`
 *  and is banned by tests/design-tokens.test.ts, while the `-text` sibling reads 5.96:1
 *  here and 4.86:1 on the `--accent` a hover paints underneath it.
 *
 *  THE `hover:` HALF IS NOT REDUNDANT and is the whole reason this is a pair. `ghost`
 *  carries `hover:text-accent-foreground` — a NEUTRAL hover text colour — so without a
 *  `hover:` of its own the destructive icon would turn grey at the moment the cursor
 *  settles on it and the pointer is about to click. Both are `hover:` text colours in the
 *  same tailwind-merge group, and this one is appended later, so it is the one that
 *  survives; the rendered class list is asserted rather than assumed, in
 *  tests/chrome/entities-palette.test.tsx. D-23's "hover LIGHTENS" is satisfied by
 *  `bg-accent` stepping up underneath, which is the neutral ramp's own hover.
 *
 *  WHAT THE EMOJI DID — the mechanism, once, here, because this is the class that was
 *  deleted. Absence from the webfont is NOT the reason on its own, and the paragraph that
 *  used to say so had its own counterexample twenty lines away: `fontTools` on the shipped
 *  `fonts/inter-variable-latin.woff2` (230 cmap entries) reports ALL of ⬇ 🗑 ❄ 🔒 🔓 absent
 *  — and `▦`, `⬒` and `Δ` absent too, and those three render monochrome and take `color`
 *  fine. Absence only hands the codepoint to the system cascade; which face the cascade
 *  reaches FIRST is what decides whether `color` survives.
 *
 *  Measured, rather than reasoned: rendered at `color: red` on this chrome's stack in
 *  Chrome, 🗑 / ❄ / 🔒 / 🔓 come back in full colour (Apple Color Emoji is the first face
 *  covering them) and ignore it, while `▦` / `⬒` / `Δ` come back red. So for DELETE the
 *  old destructive class was genuinely inert.
 *
 *  ⬇ IS THE EXCEPTION, and it is worth stating because it is the sever verb: Apple Symbols
 *  covers U+2B07, the cascade reaches it before the emoji face, and the arrow renders
 *  MONOCHROME and red. The sever verb's deleted `text-destructive` was therefore not dead
 *  code — it worked, and dropping it lost a tone that was really being painted. Which is
 *  also the argument for the swap over restoring the class: a `currentColor` SVG carries
 *  the tone on every machine, and the old behaviour was one font cascade's accident. */
const DESTRUCTIVE_VERB_CLASS =
	"text-destructive-text hover:text-destructive-text";

/** The grid's column count: the row's own control, the Δ badge, then open / freeze /
 *  sever / delete.
 *
 *  Declared as `aria-colcount` and restated per cell as `aria-colindex` because the Δ
 *  column is CONDITIONAL — it renders only on a row the standing drift report touches.
 *  Without the pair, a reader walking → would be told "column 3 of 5" on one row and
 *  "column 3 of 6" on the next for the same verb. This is exactly what ARIA 1.2 provides
 *  the two attributes for; the alternative (an always-rendered empty cell) would put a
 *  `gap-1` of dead space on every undrifted row. */
const COLUMNS = 6;

/** One row verb's control, in whichever of the two documentation channels its state
 *  can actually use. One component so the four verbs cannot drift apart on this again
 *  (they did twice: freeze and sever shipped with no tooltip at all, and bake's promised
 *  to sever a recipe on a row where it could not).
 *
 *  AVAILABLE → `ActionTip`, a real tooltip that opens on FOCUS as well as hover (D-25).
 *  That is the half a `title` never had: these are the verbs that open, freeze, sever and
 *  delete a committed stamp — three of them CHANGE it and two are in D-23's destructive
 *  lane (`tone`; freeze is protective) — and until F4.5c Task 8 the sentence explaining
 *  each one was reachable only by hovering a mouse.
 *
 *  BLOCKED → `ReasonTip`, because a disabled button takes neither pointer events nor focus
 *  and no tooltip has a channel to it at all; the reason rides a wrapper span for the mouse,
 *  the `aria-label` for everyone else, and a toast when the verb is PRESSED (W-1) — the one
 *  channel that does not have to be discovered first. The button carries no `title` in
 *  EITHER state —
 *  the double-`title` this used to ship (wrapper for the blocked case, button for the live
 *  one) is what D-25 replaced.
 *
 *  A verb shows EITHER an `Icon` or a `label`, and an `Icon` is `aria-hidden`: the
 *  accessible name is the `aria-label` built below from `verb` + the entity id (+ the
 *  blocked reason), never the pictograph. So the icon set can change without a single
 *  lookup in the tests moving — and none did when the row's glyphs stopped being emoji.
 *  (Which is also why the glyphs need their OWN assertion; the accessible name cannot
 *  notice a sever arrow turning into a `Copy`.) */
/** What a verb SHOWS, as an exclusive pair rather than two independent optionals.
 *
 *  Exactly one of the two is required, and the type now says so. As two `?:` fields it
 *  admitted both nonsense shapes: NEITHER (a button with no visible content, caught only
 *  by the tone test's `visible` column) and BOTH — where the render below silently
 *  discards the `label`, which is precisely the "styling that reads as though it does
 *  something" this whole swap exists to remove. Both typechecked clean, and BOTH left the
 *  full suite green. `never` on the absent side is what makes them exclusive, and it costs
 *  nothing at runtime.
 *
 *  `Icon` is rendered at the size ui/button.tsx's own `[&_svg]:size-4` sets — a per-icon
 *  `h-3 w-3` here would be DEAD CODE, because that arbitrary variant compiles to a
 *  descendant selector (`.…size-4 svg`) which outranks a class on the svg itself.
 *  `tests/design-tokens.test.ts` scans for that mistake across the whole chrome now, since
 *  this file is where it was noticed and `Palette.tsx` was already shipping two. */
type RowVerbGlyph =
	| { Icon: LucideIcon; label?: never }
	| { Icon?: never; label: string };

function RowVerb(
	props: {
		entityId: number;
		/** The verb, as it appears in the accessible name: `freeze entity 7`. */
		verb: string;
		/** Which of D-23's two lanes this verb is in. REQUIRED, and a union rather than an
		 *  optional flag, so a fifth verb has to answer the question instead of defaulting
		 *  quietly into neutral — which is exactly how the destructive pair lost its colour
		 *  the first time. */
		tone: "neutral" | "destructive";
		/** Why the verb is unavailable, or null when it is. */
		blocked: string | null;
		/** The sentence the verb's own label has no room for, shown while it is available. */
		hint: string;
		/** The registry action whose KEY does this same thing to this same row, when one
		 *  does. Absent on a row the key would not reach — see the delete verb's call
		 *  below. */
		actionId?: string;
		/** Which grid column this verb occupies ({@link COLUMNS}). Passed per verb rather
		 *  than counted, because the Δ cell is conditional — a counted index would report a
		 *  different column for `freeze` depending on whether the row happened to drift. */
		colIndex: number;
		onClick: () => void;
	} & RowVerbGlyph,
) {
	const { blocked } = props;
	const control = (
		<Button
			type="button"
			size="sm"
			variant="ghost"
			// OUT of the tab order, always. The grid is ONE tab stop and → is how a row's
			// verbs are reached; a verb that kept its own stop would put the ~6N cost
			// straight back. React owning this `tabIndex` is safe precisely because the
			// roving hook writes only the first cell's control and never this one.
			tabIndex={-1}
			className={cn(
				ROW_BUTTON_CLASS,
				props.tone === "destructive" && DESTRUCTIVE_VERB_CLASS,
			)}
			disabled={blocked !== null}
			aria-label={
				blocked === null
					? `${props.verb} entity ${props.entityId}`
					: `${props.verb} entity ${props.entityId} (${blocked})`
			}
			onClick={props.onClick}
		>
			{/* Read off `props` rather than a destructured local ON PURPOSE: the check is
			    what NARROWS `RowVerbGlyph`, and pulling `Icon` out first makes the two
			    fields independent again and `props.label` `string | undefined`. */}
			{props.Icon === undefined ? (
				props.label
			) : (
				<props.Icon aria-hidden="true" />
			)}
		</Button>
	);
	return (
		<GridCell colIndex={props.colIndex}>
			{blocked === null ? (
				<ActionTip hint={props.hint} actionId={props.actionId}>
					{control}
				</ActionTip>
			) : (
				<ReasonTip reason={blocked}>{control}</ReasonTip>
			)}
		</GridCell>
	);
}

/** The frozen/baked state chip. Muted, not semantic-coloured: these are states
 *  of a record, not warnings — the disabled Open carries the consequence. The
 *  glyph is decorative and the WORD is the accessible text, so a lookup by
 *  visible text still finds "frozen" / "baked".
 *
 *  "Muted" was a HALF-TRUTH while the glyph was a 🔒: the padlock ignored
 *  `text-muted-foreground` (see `DESTRUCTIVE_VERB_CLASS` for why), so the chip read as
 *  grey text beside a full-colour pictograph. A lucide `Lock` inherits the chip's own
 *  colour and the claim above becomes true of the whole chip. The glyph's IDENTITY is
 *  asserted in tests/chrome/entities-palette.test.tsx — a padlock states the STATE while
 *  the freeze verb beside it shows the ACTION, and nothing else in the file holds that.
 *
 *  It carries its own size, unlike a verb's icon, and the `h-3 w-3` is LIVE: this is a
 *  plain `<span>`, not a `Button`, so no `[&_svg]:size-4` outranks it. 12 px fits the
 *  13.33 px line box the chip inherits — `--text-xs--line-height` is `calc(1 / 0.75)`,
 *  which is UNITLESS, so it inherits as a number and recomputes against the child's own
 *  10 px rather than staying the parent's 16 px box. (`text-2xs` sets no leading of its
 *  own, deliberately — styles.css argues that at `--text-2xs`.) Verified in Chrome:
 *  13.3333 px. So the headroom is 1.33 px, not 4, which is still enough to keep the swap
 *  off the row's height but is not the number to reason from next time. */
function StateBadge({ label, Icon }: { label: string; Icon?: LucideIcon }) {
	return (
		<span className="flex items-center gap-0.5 rounded bg-muted px-1 text-2xs uppercase tracking-wide text-muted-foreground">
			{Icon !== undefined && <Icon aria-hidden="true" className="h-3 w-3" />}
			<span>{label}</span>
		</span>
	);
}

export function EntitiesList(props: {
	entities: readonly FieldEntityInfo[];
	/** The host's selected entity id (`subscribeEntitySelection`), or null. */
	selectedId: number | null;
	/** Entities the STANDING drift report touches — the Δ badge's rows. */
	driftedIds: ReadonlySet<number>;
	/** Select this entity on the host (host.selectEntity) — the write half of the
	 *  bidirectional sync. */
	onSelect: (id: number) => void;
	/** Bring the drift report into view (a Δ badge click). */
	onShowDrift: () => void;
	/** Open a reconfigure session on this entity (host.openEntity). */
	onReconfigure: (id: number) => void;
	/** Flip the entity's frozen flag (host.setEntityFrozen). */
	onFreeze: (id: number, frozen: boolean) => void;
	/** Request a delete. The PALETTE owns the confirmation — this list never
	 *  removes a stamp on its own click. */
	onDelete: (id: number) => void;
	/** Request a bake. The PALETTE owns the confirmation — this list never severs
	 *  a recipe on its own click (bake is the one irreversible verb). */
	onSever: (id: number) => void;
}) {
	const { entities, selectedId, driftedIds } = props;
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const selectedRow = useRef<HTMLDivElement | null>(null);
	// The two-axis keyboard model, shared with the flags and history grids — see
	// `useRowGrid` for which APG pattern this is and why `listbox` is not available to a
	// row that carries buttons.
	//
	// SELECTION FOLLOWS THE CURSOR here, which is the Finder / Photoshop / Blender-outliner
	// behaviour and is what the backlog entry that asked for this named: the state being
	// roved over already exists and is already bidirectional (`subscribeEntitySelection`),
	// so arrowing is that same write on a keyboard rather than a new concept. It costs one
	// host call per press, and that is the right trade because `selectEntity` is CHEAP and
	// REVERSIBLE — it draws the footprint box and nothing else. The DOM order of the stops
	// is the render order of `entities`, so the index IS the entity and no id has to be
	// threaded through the markup to find it again.
	const grid = useRowGrid((rowId) => {
		// BY NAME. `useRowGrid`'s own docblock carries the measured defect the id closes;
		// the short version is that the expanded-params row is a row too, so counting stops
		// makes `entities[i]` address the wrong stamp the moment anything lands in it.
		//
		// The null check is FIRST and is not decoration: `Number(null)` is 0, so folding it
		// into the `Number.isInteger` guard would turn "a row that names nothing" into
		// "select entity 0" — a real id.
		if (rowId === null) return;
		const id = Number(rowId);
		if (Number.isInteger(id)) props.onSelect(id);
	});

	// A refresh can remove the expanded entity (⌘Z undoes the whole commit, the row's
	// delete removes it outright): drop the expansion so it does not outlive its row.
	useEffect(() => {
		if (
			expandedId !== null &&
			!entities.some((e) => e.entityId === expandedId)
		) {
			setExpandedId(null);
		}
	}, [entities, expandedId]);

	// The READ half of the sync: a selection made in the VIEWPORT has to reach a
	// row that may be scrolled out of the palette, or the two surfaces agree in
	// state and disagree on screen. `block: "nearest"` scrolls only when the row is
	// actually out of view. The ref is genuinely nullable — the section is
	// collapsed by default, so there is often no row element at all.
	//
	// Keyed on the SELECTION alone, deliberately. Adding `entities` would re-scroll
	// on every entity tick — a commit elsewhere, a freeze on another row, a ⌘Z —
	// and each one would throw away wherever the user had scrolled this palette to.
	// What that costs is the case where a row MOVES under a standing selection
	// (only a delete above it can do that, and only by one row), which is a far
	// smaller loss than yanking the scroll position out from under someone
	// mid-read.
	useEffect(() => {
		if (selectedId === null) return;
		selectedRow.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);

	return (
		<CollapsibleSection
			title={`Entities (${entities.length})`}
			// INHERITED from when this was reference context inside FieldPanel, and
			// now questionable rather than obviously right: D-14 just made it the
			// layers panel, and a layers panel that starts closed hides the READ half
			// of the selection sync — pick something in the viewport and nothing
			// visibly happens until you open a section. Left closed for this task
			// because the answer belongs with the palette-layout pass (Task 8), which
			// decides what the controls column opens on and is where a default that
			// costs vertical space has to be paid for. Open-state stays per-mount
			// either way: no persistence.
			defaultOpen={false}
		>
			{entities.length === 0 ? (
				// OUTSIDE the grid, not a row in it: a `role="grid"` may hold rows and
				// nothing else, and an empty list has no row to put this on.
				<p className="px-1 text-xs text-muted-foreground">
					no committed stamps yet
				</p>
			) : (
				// `useRowGrid`'s header carries the whole argument for `grid` over `listbox` /
				// `tree` / no role at all, and the markup below is that module's too — the
				// stop selector is a claim about cell structure, so the structure is not
				// hand-rolled here.
				<Grid
					grid={grid}
					label="committed stamps"
					columns={COLUMNS}
					className="flex flex-col gap-0.5"
				>
					{entities.map((e) => {
						const expanded = e.entityId === expandedId;
						const baked = e.baked === true;
						const frozen = e.frozen === true;
						const selected = e.entityId === selectedId;
						return (
							<Fragment key={e.entityId}>
								<GridRow
									rowId={String(e.entityId)}
									ref={selected ? selectedRow : null}
									className="flex items-center gap-1"
								>
									<GridCell colIndex={1} className="flex min-w-0 flex-1">
										<ActionTip hint="select this stamp and show its recipe">
											<button
												type="button"
												aria-expanded={expanded}
												// The selected state, in the markup rather than only in a
												// class: "the current item in this list" is exactly what
												// aria-current means, and it is what makes the sync assertable
												// without reaching for a Tailwind string.
												aria-current={selected ? "true" : undefined}
												// ONE click, two effects, and they are not redundant: the
												// selection is HOST state (it draws the footprint box and is
												// what the viewport's own pick writes), the expansion is this
												// list's display state. Collapsing therefore leaves the entity
												// selected — un-expanding a row is not a statement about what
												// is being worked on. ⏎ on the row routes through this same
												// handler (the grid clicks the control), so the key and the
												// mouse cannot come to mean different things.
												onClick={() => {
													props.onSelect(e.entityId);
													setExpandedId(expanded ? null : e.entityId);
												}}
												className={cn(
													"flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/50",
													expanded && "bg-muted",
													selected && "bg-primary/15 ring-1 ring-primary/40",
												)}
											>
												<span aria-hidden="true">▦</span>
												<span
													className={cn(
														"min-w-0 flex-1 truncate font-mono",
														// A frozen row reads as protected rather than active.
														frozen && "text-muted-foreground",
													)}
												>
													{rowSummary(e)}
												</span>
												{frozen && <StateBadge label="frozen" Icon={Lock} />}
												{baked && <StateBadge label="baked" />}
											</button>
										</ActionTip>
									</GridCell>
									{driftedIds.has(e.entityId) && (
										<GridCell colIndex={2}>
											<ActionTip hint="the last reconfigure disturbed something here — show the drift report">
												<Button
													type="button"
													size="sm"
													variant="ghost"
													tabIndex={-1}
													className={cn(ROW_BUTTON_CLASS, "text-amber-500")}
													aria-label={`show drift near entity ${e.entityId}`}
													onClick={props.onShowDrift}
												>
													Δ
												</Button>
											</ActionTip>
										</GridCell>
									)}
									<RowVerb
										entityId={e.entityId}
										verb="open"
										label="Open"
										tone="neutral"
										colIndex={3}
										blocked={openBlockedReason(e)}
										hint="reconfigure this stamp"
										onClick={() => props.onReconfigure(e.entityId)}
									/>
									<RowVerb
										entityId={e.entityId}
										verb={frozen ? "unfreeze" : "freeze"}
										// The pair the emoji trio already spelled (❄ / 🔓, with 🔒 on the
										// badge between them), kept rather than re-chosen: the button shows
										// the ACTION, so an unfrozen row offers the snowflake and a frozen
										// one offers the padlock coming off.
										Icon={frozen ? LockOpen : Snowflake}
										// Freeze is protective, not destructive — the neutral lane, and the
										// contrast with its two neighbours is the point of colouring any of
										// them.
										tone="neutral"
										colIndex={4}
										blocked={freezeBlockedReason(e)}
										// The freeze consequence is stated UNCONDITIONALLY rather than
										// only on the row that has a session open, and it costs nothing
										// to do so: the sentence is true of every unfrozen row (the host
										// cancels a session on the entity it freezes), so the wider
										// phrasing makes the warning no weaker while leaving this list
										// uncoupled from the session. That coupling IS available since
										// F4.5b Task 2 — the session is a shell context (`useFieldStamp`)
										// any surface may read — and is declined rather than unreachable:
										// a tooltip that re-renders on every nudge of an unrelated stamp
										// is a poor trade for one word.
										hint={
											frozen
												? "allow this stamp to be reconfigured again"
												: "protect this stamp from reconfigure — ends any reconfigure session open on it"
										}
										onClick={() => props.onFreeze(e.entityId, !frozen)}
									/>
									{/* The DOWN ARROW is D-14's bake glyph, not duplicate — see the header
									    for why `ArrowDownToLine` and not lucide's `Copy`. The VERB
									    is "sever", not "bake", because the bar's Bake button and
									    `world.makeDefault` are two other operations under that word and
									    neither has anything to do with this one: those write the world
									    and point the game at it, this severs ONE stamp's recipe. The
									    resulting entity STATE is still `baked` — that word is core's,
									    and the badge keeps it — so the hint names both halves. */}
									<RowVerb
										entityId={e.entityId}
										verb="sever"
										Icon={ArrowDownToLine}
										// The one IRREVERSIBLE verb on the row, which is a stronger claim on
										// the destructive tone than delete's: a delete is ⌘Z-able and a
										// sever is not.
										tone="destructive"
										colIndex={5}
										blocked={bakeBlockedReason(e)}
										hint="sever this stamp's recipe — permanent; it becomes a baked entity"
										onClick={() => props.onSever(e.entityId)}
									/>
									<RowVerb
										entityId={e.entityId}
										verb="delete"
										Icon={Trash2}
										tone="destructive"
										colIndex={6}
										blocked={deleteBlockedReason(e)}
										hint="remove this stamp and its ops"
										// The ONE row verb a KEY also does — and only on the SELECTED row.
										// `edit.delete` acts on `ctx.selectedEntity`, so ⌫ pressed while
										// another row is selected does not touch this one; annotating every
										// row with the keycap would be a claim about the keyboard that is
										// false on all but one of them. The keycap itself is never spelled
										// here — `ActionTip` reads it off the registry, so a rebind moves it.
										actionId={selected ? "edit.delete" : undefined}
										onClick={() => props.onDelete(e.entityId)}
									/>
								</GridRow>
								{expanded && (
									// The params <dl> is its OWN row rather than a block inside the row
									// above: a `role="row"` may hold cells and nothing else, and a <dl>
									// smuggled in beside five gridcells is the shape that makes a screen
									// reader announce a sixth, empty column. It holds no control, so the
									// roving stop never lands here — and it carries NO `rowId`, so even if
									// something focusable did land in it the row axis would report a
									// nameless row and select nothing.
									<GridRow>
										<GridCell colIndex={1} colSpan={COLUMNS}>
											<dl className="grid grid-cols-[auto_1fr] gap-x-3 px-6 py-1 text-xs text-muted-foreground">
												{Object.entries(e.params).map(([k, v]) => (
													<Fragment key={k}>
														<dt className="font-mono">{k}</dt>
														<dd className="tabular-nums">{formatParam(v)}</dd>
													</Fragment>
												))}
											</dl>
										</GridCell>
									</GridRow>
								)}
							</Fragment>
						);
					})}
				</Grid>
			)}
		</CollapsibleSection>
	);
}
