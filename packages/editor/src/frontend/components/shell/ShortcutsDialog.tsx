// The keyboard-shortcut overlay (burger → Help → Keyboard shortcuts): every binding the
// editor answers to, in one place, because until now the only way to learn the viewport
// keys was to read `field-host.ts`.
//
// The table below is HAND-MAINTAINED and hand-verified. Every row was read off its source
// when it was written — the four global chords from `lib/keybindings.ts`, everything else
// from `viewport-host/field-host.ts`'s `onKeyDown`/`onWheel`/`onPointerDown` and
// `viewport-host/input-map.ts`'s `arrowNudgeSteps`. Nothing here is derived at runtime, so
// nothing here fails when a binding moves: **re-verify this table against those files
// whenever a binding changes.** The status bar's `KEYMAP` line is the same claim in
// miniature and moves with it.
//
// MIGRATION (until F4.5b): the command/keybinding registry replaces this file's data —
// once bindings are declared once and read by both the dispatcher and the UI, this dialog
// renders that registry and the hand-maintenance note above goes away.
import { Fragment } from "react";
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

const GROUPS: BindingGroup[] = [
	{
		title: "Global",
		note: "Live anywhere in the editor, inside a text field too (the browser default they replace is worse). Suppressed while a confirm dialog is open. ⌘ is Ctrl on Windows and Linux.",
		rows: [
			{
				keys: "⌘S",
				what: "Save the world — an untitled one opens the drawer to be named first",
			},
			{
				keys: "⌘Z",
				what: "Undo the last field op — the field's op log is the editor's ONE history",
			},
			{ keys: "⇧⌘Z", what: "Redo" },
			{
				keys: "⌘\\",
				what: "Hide every palette, or restore the exact arrangement",
			},
		],
	},
	{
		title: "Viewport — camera",
		note: "The viewport bindings need the canvas focused: click it, and it shows a focus ring while it holds the keys.",
		rows: [
			{
				keys: "right-drag",
				what: "Look around (the browser context menu is suppressed over the canvas)",
			},
			{ keys: "W / S", what: "Fly forward / back" },
			{ keys: "A / D", what: "Fly left / right" },
			{ keys: "Q / E", what: "Fly down / up" },
			{ keys: "⇧ while flying", what: "3× boost, while held" },
		],
	},
	{
		title: "Viewport — tools",
		rows: [
			{
				keys: "left-drag",
				what: "Apply the armed tool — dig, fill or smooth — for as long as the button is down",
			},
			{
				keys: "⌥ left-click",
				what: "Sample the material under the cursor (never strokes, so it works in every mode)",
			},
			{
				keys: "left-click",
				what: "With a gesture armed it selects instead of digging: material and void take one click, box and segment take two",
			},
			{ keys: "wheel", what: "Brush radius" },
			{
				keys: "[ / ]",
				what: "Brush radius, one step per press — hold to keep resizing",
			},
			{
				keys: "⇧ (hold)",
				what: "Smooth while held; the armed tool comes back on release",
			},
			{ keys: "⌃ (hold)", what: "Swap dig ↔ fill while held" },
			{
				keys: "⌘Z / ⇧⌘Z",
				what: "Undo / redo — the canvas handles the chord itself so one press steps the log once, not twice",
			},
		],
	},
	{
		title: "Stamp sessions",
		note: "While a generator stamp is live — its ghost is on screen and the arrows have something to move.",
		rows: [
			{ keys: "⏎", what: "Commit the ready ghost, or apply a reconfigure" },
			{
				keys: "esc",
				what: "Discard the session — with no session it drops a pending segment anchor instead",
			},
			{ keys: "← / →", what: "Nudge the region one lattice step −X / +X" },
			{ keys: "↑ / ↓", what: "Nudge one step −Z / +Z" },
			{
				keys: "⇧↑ / ⇧↓",
				what: "Nudge one step +Y / −Y (a four-key pad has no third pair, so height rides the modifier)",
			},
		],
	},
];

export function ShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/* Scrolls inside itself: the list is longer than a short window, and a dialog
			    that grows past the viewport takes its own close button off screen. */}
			<DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>
						Everything this build binds. The viewport groups need the canvas
						focused.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					{GROUPS.map((group) => (
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
