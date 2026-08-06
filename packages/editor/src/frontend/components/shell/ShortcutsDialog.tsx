// The keyboard-shortcut overlay (`?`, or burger → Help → Keyboard shortcuts): every binding
// the editor answers to, in one place, because otherwise the only way to learn the viewport
// keys is to read source.
//
// It LISTS ITS OWN KEY, and not by writing one down: `?` is `help.shortcuts` in the registry
// (the holistic gate's ruling 3), so it arrives here through the same derivation as every
// other row. An overlay that could not say how to reopen itself would be the joke version of
// the binding.
//
// The SHELL owns its open flag, beside the ⌘K palette's — it used to be `BurgerMenu`'s, which
// is precisely what made `?` unbindable: the window key dispatcher cannot reach a `useState`
// inside a component that is unmounted whenever the menu is shut.
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
// rows are written out here and must be re-verified against `field-host/field-host.ts`
// when one of them changes.
import { Fragment } from "react";
import { useActionContext } from "../../hooks/useActionContext.tsx";
import { useViewportFocusReturn } from "../../hooks/useViewportFocusReturn.ts";
import {
	ACTION_GROUPS,
	ACTIONS,
	type ActionCtx,
	type ActionGroup,
	capOf,
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

/** The condition each registry group is under — the thing that makes a row true. The
 *  groups themselves (which ones, in what order, called what) come from `ACTION_GROUPS`;
 *  only these notes are the overlay's, because only the overlay has room for them.
 *
 *  DELIBERATELY NOT a count: this said "which five" until `help` made it six, which is the
 *  rot a `Record<ActionGroup, string>` is otherwise immune to — the type forces a NOTE for a
 *  new group (that is what caught `help`), and forces nothing about a sentence describing the
 *  set. These are RENDERED as plain text (`<p>{group.note}</p>`), so they carry no markup:
 *  a backtick here reaches the screen as a backtick. */
const GROUP_NOTES: Record<ActionGroup, string> = {
	world:
		"Live anywhere in the editor, inside a text field too (the browser default they replace is worse). Suppressed while a confirm dialog is open. ⌘ is Ctrl on Windows and Linux.",
	edit: "Bare keys do nothing while you are typing in a field. The three that act on a stamp (⌘J, G, ⌫) need one selected — the menu names which.",
	tool: "Refused while a stamp session is live — which says so rather than going quiet — and S alone stands down while the right button is held, because S is also fly-backward.",
	session: "Live only while a stamp, reconfigure or move session is on screen.",
	view: "Live anywhere. F frames the selected stamp, else the cell selection.",
	help:
		"Live anywhere a bare key is — so not while you are typing in a field. ? is ⇧/ on " +
		"a US layout; the binding is on the character, so whatever your layout does to " +
		"produce one works.",
};

const CANVAS_GROUP: BindingGroup = {
	title: "Viewport — canvas",
	// Stated the way the canvas actually behaves: its ring is `focus-visible`, which
	// browsers paint for keyboard focus and generally NOT for a pointer click. So a
	// click does arm these keys, silently.
	//
	// RING-ON-CLICK: RULED, F4.5c Task 10 — it stays `focus-visible`-only. The question
	// this comment left open was whether a pointer click on the canvas should paint the
	// ring too, and the answer is no on three counts. It carries no information: the click
	// IS the evidence, the user's own pointer just landed there, and a persistent border
	// drawn to announce something they did is the Attention Rule spent for nothing. It is
	// not the DCC norm: Blender, Maya and Unreal all take viewport focus on click in
	// silence. And the armed state is already legible without it — the status bar's keymap
	// line is the surface that says which keys are live, and it says so in words.
	//
	// What made the ring feel necessary was the defect beside it, not the absence of a
	// cue: a click armed these keys and the next panel interaction silently disarmed them
	// again, so nobody could tell what state they were in. That is what the conditional
	// focus return closes — dismiss an overlay you opened while flying and the keys come
	// back — which is why this is a call the same task gets to make. The gate can overturn
	// it; if it does, the change is one `focus:` variant on the canvas's className and this
	// note's last clause.
	note: "These need the canvas focused — everything above works from anywhere. Clicking the viewport focuses it; the focus ring shows when you Tab to it, not on a click. Opening a panel or menu while flying does not cost you the keys: dismissing it hands them back.",
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
			// The second clause is load-bearing rather than helpful. The tips are under the
			// WCAG 2.2 SC 2.5.8 target-size minimum and rest on that SC's equivalent-affordance
			// exception; the six views carry no `keys`, so the registry-rendered part of this
			// overlay cannot mention them, and without this sentence the one surface a keyboard
			// user consults would say the tips are the only route (`AxisTriad`'s HIT/NEG_HIT).
			what: "The corner axis gizmo's six ends snap the view to that axis — click one, or Tab to it and press ⏎. The burger's View menu lists the same six",
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
	// The cap is DERIVED from the binding, so the overlay — the one surface whose whole job
	// is being right about keys — cannot advertise a chord nothing answers.
	return ACTIONS.flatMap((a) => {
		const keys = a.group === group ? capOf(a) : undefined;
		return keys === undefined ? [] : [{ keys, what: a.hint ?? a.label(ctx) }];
	});
}

export function ShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	// The dialog is mounted UNCONDITIONALLY, by the shell (`?` has to reach it from a window
	// listener, and the burger unmounts its own content on close, so a dialog rendered in
	// there would be torn down by the click that opened it)
	// — which is exactly why the action context is read one level down, in the body.
	// Radix's Portal renders nothing while closed, so the subscription does not exist
	// then; read here, a closed overlay would rebuild five filtered groups and ~30 rows
	// on every stats push, and at POINTER RATE during a grab (the session is a ctx dep).
	// The same split the status bar's KeymapLine makes, for the same reason.
	const focusReturn = useViewportFocusReturn();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/* Scrolls inside itself: the list is longer than a short window, and a dialog
			    that grows past the viewport takes its own close button off screen. */}
			<DialogContent
				className="max-h-[80vh] max-w-xl overflow-y-auto"
				{...focusReturn.overlay}
			>
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>
						Everything this build binds. The last group needs the canvas
						focused.
					</DialogDescription>
				</DialogHeader>
				<ShortcutsBody />
			</DialogContent>
		</Dialog>
	);
}

function ShortcutsBody() {
	const ctx = useActionContext();
	const groups: BindingGroup[] = [
		...ACTION_GROUPS.map((g) => ({
			title: g.title,
			note: GROUP_NOTES[g.id],
			rows: registryRows(g.id, ctx),
		})).filter((g) => g.rows.length > 0),
		CANVAS_GROUP,
	];
	return (
		<div className="space-y-4">
			{groups.map((group) => (
				<section key={group.title} className="space-y-1.5">
					<h3 className="font-medium text-2xs text-muted-foreground uppercase tracking-wide">
						{group.title}
					</h3>
					{group.note && (
						<p className="text-2xs text-muted-foreground">{group.note}</p>
					)}
					{/* A description list, not a table: each row is one term and its
							    meaning, and the grid is what lines the keycaps up. */}
					<dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
						{group.rows.map((row) => (
							<Fragment key={row.keys}>
								<dt>
									<kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
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
	);
}
