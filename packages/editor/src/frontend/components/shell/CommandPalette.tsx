// The ⌘K command palette: D-12's SEVENTH registry reader, and the only one that renders
// the WHOLE table at once.
//
// It is a VIEW, not a surface with verbs of its own. Every label is `def.label(ctx)`,
// every keycap is `capOf(def)`, every refusal is `controlVerdict` — so a row cannot say
// something the burger, the rail or the keyboard would not. Nothing here decides what a
// verb is called or when it may run; if it ever does, that is the D-12 violation this file
// exists to make obvious.
//
// WHY IT EXISTS (D-F4.5-12): the burger's View group is thirteen rows, and the whole menu was
// 33 items in one flat run before the holistic gate broke the three groups into submenus.
// Menu depth is a UX ceiling either way — scrolled flat or traversed — and random access by
// name is the standard answer: this is what makes the submenus' extra step cheap, and what
// lets the tree keep growing without a traversal for every verb.
//
// A DIALOG, not a floating palette. It carries no `PaletteId`, nothing persists it, `⌘\`
// does not hide it and it has no geometry to drag — it is modal, transient, and gone the
// moment it has done its one job. That is why `ctx.run.openCommandPalette` is its own verb
// beside `summonPalette` rather than a sixth member of the arrangement.
//
// WHAT THE MOCK (frame 5) HAS AND THIS DOES NOT, and why:
//   - a per-row GLYPH. Nothing in the registry carries an icon, and there is no authored
//     set to draw from — a per-action `icon?` field would be perfectly single-homed, so
//     this is a cost-and-scope call rather than a principled refusal, and it stays open.
//   - a per-row GROUP TAG. Superseded rather than dropped: the mock's list is flat, so
//     each row had to name its own group; these are grouped, with a heading each.
//   - world and entity rows ("Bake world 'mine-01'"). Aspirational in the mock — this
//     renders `ACTIONS` and the tool families, and nothing else.
import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useActionContext } from "../../hooks/useActionContext.tsx";
import { useViewportFocusReturn } from "../../hooks/useViewportFocusReturn.ts";
import type { ControlVerdict } from "../../lib/actions.ts";
import {
	ACTION_GROUPS,
	ACTIONS,
	type ActionCtx,
	type ActionDef,
	type ActionGroup,
	byId,
	capOf,
	controlVerdict,
	runNamed,
	TOOL_FAMILIES,
} from "../../lib/actions.ts";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "../ui/command.tsx";

/** The palette's own chord, read off the table it renders. A hand-typed "⌘K" in the
 *  footer is a keycap that outlives its binding — the exact defect the registry exists to
 *  make impossible, committed by the surface that advertises the registry.
 *
 *  Through `byId`, which THROWS at module init: a renamed action must fail the import, not
 *  render an empty `<kbd>` that nobody notices. */
const SELF = byId("view.commandPalette");

/** One row, resolved against the current state. Every field comes from the registry. */
type Row = {
	/** cmdk's selection key. The action ID, never the label: cmdk otherwise derives a
	 *  value from the rendered text, and these labels are CONTEXTUAL ("Undo dig" becomes
	 *  "Undo fill" as the user works), so the selection would move under a relabel. */
	value: string;
	group: ActionGroup;
	label: string;
	keys: string | undefined;
	/** May this row run, and what to say when it may not. */
	verdict: ControlVerdict;
	/** What ELSE this row answers to. The visible label has to be here explicitly: cmdk
	 *  scores `value` + `keywords`, and `value` is the id — without this, "Undo dig"
	 *  would be findable by "undo" (the id says so) but not by "dig". */
	keywords: string[];
	run: () => void;
};

/** The row's accessible NAME, and the whole of what the palette says about it: what it is
 *  called, what runs it, and — when it will not run — why. The rail's formula (a refused
 *  control puts its reason in the name, because a name is the one channel every input
 *  method gets), with the keycap kept because a palette is where people learn chords. */
function rowName(row: Row): string {
	const reason = row.verdict.runnable ? null : row.verdict.reason;
	return [row.label, row.keys, reason === null ? null : `(${reason})`]
		.filter((part) => part !== undefined && part !== null)
		.join(" ");
}

function actionRow(def: ActionDef, ctx: ActionCtx): Row {
	const label = def.label(ctx);
	return {
		value: def.id,
		group: def.group,
		label,
		keys: capOf(def),
		verdict: controlVerdict(def, ctx),
		keywords: def.hint === undefined ? [label] : [label, def.hint],
		// Through the ONE funnel, so a row and the verb's key refuse in the same words.
		run: () => void runNamed(def, ctx),
	};
}

/** The tool families' MEMBERS — rows the `ACTIONS` table does not carry: the rail reaches
 *  them through a flyout and the keyboard through a ⇧ cycle, so without these the palette
 *  would be the one surface that cannot arm a brush effect or a flood mode by name.
 *
 *  WHO those members are is `FAMILY_ROWS` plus the host's generator registry, and naming any
 *  of them here would be a worse answer than the one a reader can already get.
 *
 *  A family with ONE member contributes none, which is the rail's own rule (it renders no
 *  flyout below a single-member column): that member IS the family's arm action, already a
 *  row above, and two rows for one verb is the defect the registry exists to prevent.
 *
 *  The label composes two registry strings — the family's stable `name` and the member's
 *  `label` — because a flat searchable list has no column headings to lean on: "Hall"
 *  alone under a "Tools" heading does not say that picking it opens a stamp session.
 *
 *  Members inherit the FAMILY's refusal. Arming a member is arming the family, so the
 *  session gate that refuses one refuses the other — the rail's flyout does the same. */
function memberRows(ctx: ActionCtx): Row[] {
	return TOOL_FAMILIES.flatMap((family) => {
		const members = family.members(ctx);
		if (members.length < 2) return [];
		const verdict = controlVerdict(family.arm, ctx);
		return members.map((member) => ({
			value: `${family.arm.id}.${member.id}`,
			group: family.arm.group,
			label: `${family.name} · ${member.label}`,
			keys: undefined,
			verdict,
			// The COMPOSED label first, and it is the whole rule `Row.keywords` states:
			// cmdk scores `value` + `keywords`, `value` is the id, so the family half is
			// searchable only where the name echoes the id. `tool.select` is called "Cell
			// select" — typing what that row visibly says found nothing at all, while
			// partial queries appeared to work through a subsequence inside the HINT.
			// Without the separator: `·` is not a character anyone types.
			keywords: [`${family.name} ${member.label}`, member.label, member.hint],
			run: () => member.arm(ctx),
		}));
	});
}

export function CommandPalette({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	// ⌘K is pressed mid-flight and the dialog has no trigger, so Radix's dismissal lands on
	// `<body>` and every viewport key with it.
	const focusReturn = useViewportFocusReturn();
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			// The SURFACE's name, not the action's, and the near-duplication is deliberate:
			// `view.commandPalette` is called "Find a command…", where the ellipsis is this
			// editor's menu convention for "opens something" — a surface cannot be named
			// after the promise to open it. Screen-reader only; the placeholder and the
			// footer are what a sighted user reads.
			title="Find a command"
			description="Every verb in the editor by name. Type to filter, ↑↓ to move, ⏎ to run, Esc to close."
			// OFF, and this is a collision rather than a preference: cmdk's vim set claims
			// ⌃N/⌃J/⌃P/⌃K, and in this editor a chord is `mod` — ⌘ OR Ctrl — and chords stay
			// live inside text fields by design. So ⌃J is `edit.duplicate` and ⌃K is this
			// palette's own key. Two owners for one press is what the ownership rule at the
			// top of `lib/actions.ts` forbids; the arrows, Home and End still navigate.
			vimBindings={false}
			// Esc is THIS dialog's, and the swallow has to happen HERE — Radix's hook, which
			// runs on a CAPTURE listener on the document, before the press reaches anything
			// inside. Without it the same press carries on to the window listener, where
			// `session.escape` steps the cancel ladder and discards the very session the user
			// opened the palette beside; the dialog swallowing its own dismiss key is what
			// keeps ONE cancel entry point true.
			//
			// NOT `preventDefault`, which would tell Radix the press was handled and leave the
			// palette open. Radix dismisses on it either way — this only stops the journey.
			//
			// A handler on the cmdk root below would MISS this: a click on a row parks focus
			// on the dialog box (a cmdk row is a `div` with no tab stop), and a press from
			// there never passes through the root at all. Measured — it was written there
			// first, and it was the case pressing on the box that found it.
			onEscapeKeyDown={(e) => e.stopPropagation()}
			// LAST, and on `CommandDialog` rather than inside it: that wrapper names both
			// props explicitly and forwards them to `DialogContent`, because its own rest
			// spread goes to cmdk's root, which would have swallowed them silently.
			{...focusReturn.overlay}
		>
			{/* Built here, rendered only while the dialog is open: Radix's Portal renders
			    nothing when closed, so the action context — which moves on every op and at
			    pointer rate during a grab — is subscribed to only while someone is looking at
			    it. The same split `ShortcutsDialog` makes, for the same reason. */}
			<CommandBody
				close={() => onOpenChange(false)}
				handOff={focusReturn.handOff}
			/>
		</CommandDialog>
	);
}

function CommandBody({
	close,
	handOff,
}: {
	close: () => void;
	/** Forward the palette's focus record to whatever the picked verb opens — see
	 *  {@link ViewportFocusReturn.handOff}. Threaded down as a prop because the hook lives
	 *  on the dialog above (which is mounted always, where this body is not). */
	handOff: () => void;
}) {
	const ctx = useActionContext();
	const rows = [
		...ACTIONS.map((def) => actionRow(def, ctx)),
		...memberRows(ctx),
	];

	/** Close, THEN run — and flushed, because React batches: `close()` before `run()` in
	 *  source is not closed-before-ran at runtime unless the close is committed first.
	 *  The ordering is load-bearing rather than tidy. Radix returns focus as part of the
	 *  close, so a verb that moves focus itself (the ones that open a surface) would have
	 *  it yanked straight back out by a close that landed after. */
	const pick = useCallback(
		(row: Row) => {
			// BEFORE the close, and unconditionally. A verb that opens a surface (`Open…`,
			// `History…`) mounts it during `row.run()`, and that surface reads the gesture
			// origin as it opens — which is strictly earlier than this palette's own deferred
			// close handler, so arming afterwards would always be a tick late. Unconditional
			// because the registry does not say which verbs open something and a per-row list
			// would be a second source for it; a forwarded answer nothing consumes is inert
			// (see `carryGestureOrigin`), and a verb that opens nothing still gets the
			// ordinary return from the close below.
			handOff();
			flushSync(close);
			row.run();
		},
		[close, handOff],
	);

	return (
		<>
			<CommandInput placeholder="Search actions…" />
			<CommandList>
				<CommandEmpty>No action matches.</CommandEmpty>
				{ACTION_GROUPS.map((group) => {
					const inGroup = rows.filter((row) => row.group === group.id);
					if (inGroup.length === 0) return null;
					return (
						<CommandGroup key={group.id} heading={group.title}>
							{inGroup.map((row) => (
								<PaletteRow key={row.value} row={row} onPick={pick} />
							))}
						</CommandGroup>
					);
				})}
			</CommandList>
			{/* The mock's footer strip. The keycap is the registry's, not a literal. */}
			<div className="flex gap-3.5 border-border border-t px-3.5 py-1.5 text-2xs text-muted-foreground">
				<span>↑↓ navigate</span>
				<span>⏎ run</span>
				<span>esc close</span>
				<kbd className="ml-auto font-mono">{capOf(SELF)}</kbd>
			</div>
		</>
	);
}

/** One row: what the verb is called, what runs it, and — refused — why, all from the
 *  registry. The whole of what this task is judged on, so it has a name. */
function PaletteRow({ row, onPick }: { row: Row; onPick: (row: Row) => void }) {
	return (
		<CommandItem
			value={row.value}
			keywords={row.keywords}
			aria-label={rowName(row)}
			// cmdk enforces this rather than trusting the handler: a disabled item registers
			// no select listener and takes no click, and is skipped by the arrows and by
			// auto-selection — so ⏎ can never land on one and find nothing there.
			disabled={!row.verdict.runnable}
			onSelect={() => onPick(row)}
		>
			<span className="truncate">{row.label}</span>
			{row.keys !== undefined && <CommandShortcut>{row.keys}</CommandShortcut>}
		</CommandItem>
	);
}
