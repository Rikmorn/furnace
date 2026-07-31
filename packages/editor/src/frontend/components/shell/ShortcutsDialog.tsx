// The keyboard-shortcut overlay (burger → Help → Keyboard shortcuts): every binding the
// editor answers to, in one place, because otherwise the only way to learn the viewport
// keys is to read source.
//
// The app-level groups are RENDERED FROM THE ACTION REGISTRY — every entry with a `keys`
// is listed, with the `hint` the table carries — so a binding that moves or dies cannot
// leave a row behind, and one that is added cannot fail to appear. That is what retired
// the hand-maintained table this file used to carry, and the migration note over it.
//
// ONE static group survives, and it is honest about why: the field canvas has a keydown
// listener of its own for the keys that steer the viewport under the pointer (the fly
// set, the radius steppers, the arrow nudges, the momentary modifiers). Those are not
// registry actions — see the ownership rule at the top of `lib/actions.ts` — so their
// rows are written out here and must be re-verified against `viewport-host/field-host.ts`
// when one of them changes.
import { Fragment } from "react";
import { useActionContext } from "../../hooks/useActionContext.tsx";
import {
	ACTIONS,
	type ActionCtx,
	type ActionGroup,
} from "../../lib/actions.ts";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog.tsx";

type Binding = {
	/** What the user presses, in the editor's keycap vocabulary (⌘ ⇧ ⌃ ⌥, as the top bar
	 *  and the status bar already write them). */
	keys: string;
	what: string;
};

type BindingGroup = {
	title: string;
	/** The condition the whole group is under — the thing that makes a row true. */
	note?: string;
	rows: Binding[];
};

/** The registry's groups, in the order a user meets them, with the condition each is
 *  under. Every row inside comes from the table. */
const REGISTRY_GROUPS: { group: ActionGroup; title: string; note?: string }[] =
	[
		{
			group: "world",
			title: "World",
			note: "Live anywhere in the editor, inside a text field too (the browser default they replace is worse). Suppressed while a confirm dialog is open. ⌘ is Ctrl on Windows and Linux.",
		},
		{ group: "edit", title: "Edit" },
		{
			group: "tool",
			title: "Tools",
			note: "Bare keys: they do nothing while you are typing in a field, while the right button is held (the letters are the fly keys then), or while a stamp session is live — which says so rather than going quiet.",
		},
		{ group: "session", title: "Session" },
		{ group: "view", title: "View" },
	];

const CANVAS_GROUP: BindingGroup = {
	title: "Viewport — canvas",
	// Stated the way the canvas actually behaves: its ring is `focus-visible`, which
	// browsers paint for keyboard focus and generally NOT for a pointer click. So a
	// click does arm these keys, silently. (Whether a click should paint a ring too is
	// a design call, not a wording one — left to the F4.5c polish pass.)
	note: "These need the canvas focused — everything above works from anywhere. Clicking the viewport focuses it; the focus ring shows when you Tab to it, not on a click.",
	rows: [
		{
			keys: "right-drag",
			what: "Look around — or orbit the selected entity, when Select is armed and something is selected (the browser context menu is suppressed over the canvas)",
		},
		{
			keys: "W A S D",
			what: "Fly forward / left / back / right — ONLY while the right button is held, because otherwise those letters are tool keys",
		},
		{ keys: "Q / E", what: "Fly down / up, same right-button rule" },
		{ keys: "⇧ while flying", what: "3× boost, while held" },
		{
			keys: "triad tips",
			what: "The corner axis gizmo's six ends snap the view to that axis — click one, or Tab to it and press ⏎",
		},
		{
			keys: "left-drag",
			what: "Apply the armed brush — Dig, Fill, Paint or Smooth — for as long as the button is down",
		},
		{
			keys: "⌥ left-click",
			what: "Sample the material under the cursor (never strokes, so it works in every mode)",
		},
		{
			keys: "wheel",
			what: "Brush radius — except under Select, which has no brush to size: there it travels the camera in and out",
		},
		{
			keys: "[ / ]",
			what: "Brush radius, one step per press — hold to keep resizing",
		},
		{
			keys: "⇧ (hold)",
			what: "Smooth while held; the armed tool comes back on release",
		},
		{
			keys: "⌃ (hold)",
			what: "Swap Dig ↔ Fill while held (Paint and Smooth pass through). On macOS ⌃+click is synthesized as a right-click, so hold ⌃ during a stroke already running — a fresh ⌃+click starts a look instead",
		},
		{
			keys: "← / →",
			what: "Nudge a live stamp region one lattice step −X / +X",
		},
		{ keys: "↑ / ↓", what: "Nudge one step −Z / +Z" },
		{
			keys: "⇧↑ / ⇧↓",
			what: "Nudge one step +Y / −Y (a four-key pad has no third pair, so height rides the modifier)",
		},
	],
};

/** The rows one registry group contributes: its keyed actions, named by the label they
 *  wear right now and explained by the sentence the table carries. */
function registryRows(group: ActionGroup, ctx: ActionCtx): Binding[] {
	return ACTIONS.filter((a) => a.group === group && a.keys !== undefined).map(
		(a) => ({
			keys: a.keys ?? "",
			what: a.hint ?? a.label(ctx),
		}),
	);
}

export function ShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const ctx = useActionContext();
	const groups: BindingGroup[] = [
		...REGISTRY_GROUPS.map((g) => ({
			title: g.title,
			note: g.note,
			rows: registryRows(g.group, ctx),
		})).filter((g) => g.rows.length > 0),
		CANVAS_GROUP,
	];
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/* Scrolls inside itself: the list is longer than a short window, and a dialog
			    that grows past the viewport takes its own close button off screen. */}
			<DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>
						Everything this build binds. The last group needs the canvas
						focused.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					{groups.map((group) => (
						<section key={group.title} className="space-y-1.5">
							<h3 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
								{group.title}
							</h3>
							{group.note && (
								<p className="text-[11px] text-muted-foreground">
									{group.note}
								</p>
							)}
							{/* A description list, not a table: each row is one term and its
							    meaning, and the grid is what lines the keycaps up. */}
							<dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
								{group.rows.map((row) => (
									<Fragment key={row.keys}>
										<dt>
											<kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
												{row.keys}
											</kbd>
										</dt>
										<dd className="text-muted-foreground">{row.what}</dd>
									</Fragment>
								))}
							</dl>
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
