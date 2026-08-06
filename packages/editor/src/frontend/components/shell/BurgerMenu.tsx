// The top bar's one menu. The TREE is the deliverable here — the shape a user (and the
// shortcut overlay) can read the editor's verbs off — not the wiring.
//
// THE TREE, since the holistic gate's ruling 3: three SUBMENUS, one per registry group the
// burger renders, over a top level of ten rows. It was one flat run of 33 items, and on the
// window the gate was walked in the tail of them were below the fold — scrollable, and
// therefore not so much reachable as huntable. The arithmetic (1221 px flat, 380 px now, and
// the ~906 px that is actually available under a 40 px top bar) lives ONCE, in
// `tests/chrome/shell.test.tsx`'s "the TREE" section, beside the case that pins the counts.
//
// WHAT STAYS AT TOP LEVEL, and the principle: things whose STATE the menu is showing, and
// doors. The five palette checkboxes are the first — their whole value is the tick, which
// answers "is the Log open?" at a glance, and a submenu would hide exactly that. "View
// options…" and "Keyboard shortcuts" are the second, and a door is one row wherever it goes.
//
// THE ARGUMENT THIS OVERRULES was this file's own: the view toggles were flat "because they
// are the ones a user reaches for mid-gesture". Three answers. That claim was the
// justification for a menu whose length then defeated it — a row you scroll to is not one
// you reach for. ⌘K post-dates the claim and is the real mid-gesture route: one chord and a
// name, no scanning (D-12). And for the pointer user the sentence describes — hand on the
// mouse, eyes on the field — a submenu is a rightward MOVE rather than a second click.
//
// WHAT THE OVERRULE COSTS, stated at its real size rather than at the size of the sentence it
// answers: within that sentence's own scope it is two rows — Normals shading and Grid have no
// chord of their own and are now two steps from the burger instead of one, while Hide palettes
// has ⌘\ and Reset workspace is rare. MENU-WIDE it is sixteen: those two plus
// `world.new/open/bake/makeDefault`, `edit.clearSelection/reselect/history` and the six axis
// views, none of which carries a chord either. Every one of the sixteen is reachable in one
// chord-and-a-name through ⌘K, which is the trade the second answer above is making.
//
// The World, Edit and View submenus are RENDERED FROM THE ACTION REGISTRY
// (`lib/actions.ts`): their titles, their labels, their disabled states and the chords
// beside them all come from the same table the window key dispatcher reads, so a menu item
// and its shortcut cannot describe different things. The `tool` and `session` groups are
// deliberately NOT here — arming a brush and ending a session are the rail's and the
// viewport's, and the shortcuts overlay is where they are discovered.
//
// What stays hand-written is what a registry action cannot express, because it is about THIS
// MENU rather than about the verb: opening a surface means handing focus to it (see
// `handingOff`), which is a fact about being reached from a menu that closes. "View options…"
// is hand-written outright — the popover is not a registry verb. "Keyboard shortcuts" is NOT:
// it is `help.shortcuts` (what `?` runs), rendered by the same `RegistryItems` the three
// submenus use, so its label, its keycap and its verb all come off the table. The only thing
// written here for it is the hand-off, which arrives as that renderer's one optional prop.
import { Menu } from "lucide-react";
import { useRef, useState } from "react";
import { useActionContext } from "../../hooks/useActionContext.tsx";
import { usePaletteSummon } from "../../hooks/usePaletteStack.tsx";
import { useViewportFocusReturn } from "../../hooks/useViewportFocusReturn.ts";
import {
	useWorkspaceActions,
	useWorkspaceState,
} from "../../hooks/useWorkspace.tsx";
import {
	ACTIONS,
	type ActionGroup,
	capOf,
	groupTitle,
	runNamed,
} from "../../lib/actions.ts";
import { PALETTE_IDS, PALETTES } from "../../lib/palette-store.ts";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";

/** The items of one registry group, in table order.
 *
 *  Its own component so the action context — which moves on every op and every drag frame —
 *  is read as DEEP as it can be. That got cheaper with the submenus rather than more
 *  expensive: Radix mounts a `SubContent` only while that submenu is open, so the three group
 *  subscriptions now cost only while the user is actually inside one, where before they cost
 *  for as long as the menu stood. The `help` copy at top level is the exception and is
 *  subscribed with the menu, which is one action's worth.
 *
 *  `onSelect` exists for exactly one group: `help`, whose row opens a dialog and must forward
 *  this menu's focus answer to it. Absent everywhere else, because a verb that opens nothing
 *  wants the ordinary canvas return.
 *
 *  IT IS CALLED FIRST, AND THAT ORDER IS INCIDENTAL — deliberately stated as such rather than
 *  as a contract, because a review swapped the two statements and the whole suite stayed green.
 *  React batches `runNamed`'s `setState` past this handler either way, so the dialog cannot
 *  mount before the hand-off lands whichever order they are written in. Reading first is how a
 *  reader expects "forward, then run" to look; nothing depends on it, and a comment claiming
 *  otherwise would be an authoritative sentence nothing checks. */
function RegistryItems({
	group,
	onSelect,
}: {
	group: ActionGroup;
	onSelect?: () => void;
}) {
	const ctx = useActionContext();
	return ACTIONS.filter((a) => a.group === group).map((action) => {
		// The chord rides BOTH branches: a checkbox action with a `keys` would
		// otherwise lose it silently, and `view.togglePalettes` is one keycap away
		// from being exactly that.
		// The cap is DERIVED from the binding (`capOf` → the registry's `keycap`), never
		// stated beside it, so a menu item cannot advertise a chord nothing answers.
		const cap = capOf(action);
		const chord = cap !== undefined && (
			<DropdownMenuShortcut>{cap}</DropdownMenuShortcut>
		);
		// `title` is shown only where it can be READ: a disabled item carries
		// `pointer-events-none`, so it never surfaces a native tooltip — which is
		// why an action whose reason applies while DISABLED puts it in the label
		// instead (world.bake, edit.history).
		//
		// A `title` and NOT an `ActionTip`, which is the one deliberate exemption
		// from D-25's sweep: a menu item is already keyboard-reachable by ↓, and a
		// tooltip anchored to it would pop on every arrow press while the user is
		// travelling past. The keycap is already here too (`chord`, right), so the
		// annotation half of D-25 has nothing to add either.
		const disabled = !action.enabled(ctx);
		const run = () => {
			onSelect?.();
			// Through the ONE funnel, so a menu item and this verb's key refuse in the same
			// words and report in the same place. `void`: a menu select cannot await, and
			// the funnel has already said whatever there was to say.
			void runNamed(action, ctx);
		};
		// A checkbox item where the action reports a checked state, a plain item
		// otherwise — the one structural difference a menu needs from the table.
		return action.checked === undefined ? (
			<DropdownMenuItem
				key={action.id}
				disabled={disabled}
				title={action.hint}
				onSelect={run}
			>
				{action.label(ctx)}
				{chord}
			</DropdownMenuItem>
		) : (
			<DropdownMenuCheckboxItem
				key={action.id}
				checked={action.checked(ctx)}
				disabled={disabled}
				title={action.hint}
				onCheckedChange={run}
			>
				{action.label(ctx)}
				{chord}
			</DropdownMenuCheckboxItem>
		);
	});
}

/** One registry group as a SUBMENU, named by the registry's own name for the set — the same
 *  string the shortcuts overlay and the command palette head their sections with. Through
 *  `groupTitle`, which THROWS: a group missing from `ACTION_GROUPS` must fail loudly, not
 *  render a nameless chevron.
 *
 *  No `DropdownMenuGroup` + `DropdownMenuLabel` + `aria-labelledby` triple in here, and that
 *  is a DELETION rather than an omission: Radix labels a `SubContent` with its own
 *  `SubTrigger`'s id (measured — `aria-labelledby` on the content is the trigger's `id`), so
 *  the association the flat groups had to hand-roll is the primitive's job now. A bare label
 *  beside the rows in here would be a second, unattached heading. */
function RegistrySubmenu({ group }: { group: ActionGroup }) {
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>{groupTitle(group)}</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				<RegistryItems group={group} />
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

export function BurgerMenu({
	onOpenViewOptions,
}: {
	/** Open the View popover next door — the menu's way into the layer gates, which are
	 *  too many to carry as items (see the View submenu below). */
	onOpenViewOptions: () => void;
}) {
	const { palettes } = useWorkspaceState();
	const { setOpen } = useWorkspaceActions();
	const summon = usePaletteSummon();
	// Radix returns focus to the trigger when the menu closes, which for an item that
	// OPENS something would pull focus straight back out of the surface just opened. This
	// flag marks the one close that is a hand-off, and the content skips its focus return
	// for it; every other close still puts focus back on the burger, where a keyboard user
	// expects it.
	const handingOff = useRef(false);
	// The OTHER answer to "where does focus go when this closes", and the two are exclusive
	// by construction below: a hand-off means the surface just opened owns focus, a canvas
	// return means the user was flying when they reached for the menu.
	const focusReturn = useViewportFocusReturn();
	// CONTROLLED so the drawer's summon and this menu's own close cannot disagree about
	// whether it is open. It used to be controlled for a second reason — the focus record
	// was taken from `onOpenChange(true)`, because a Radix MENU does not expose
	// `onOpenAutoFocus` (a private prop of `MenuContentImpl`; `MenuRootContentTypeProps`
	// omits `keyof MenuContentImplPrivateProps` outright, react-menu 2.1.20's own types).
	// That reason is gone: the record now rides the content's ref, which a menu content
	// forwards like every other one, so this site composes exactly like the other eight.
	const [menuOpen, setMenuOpen] = useState(false);
	/** Give the surface this item opens BOTH halves of the focus answer: suppress this
	 *  menu's own return, and forward its record so a journey that began on the canvas ends
	 *  there. The two hand-off items call it and nothing else does. */
	const handOff = () => {
		handingOff.current = true;
		focusReturn.handOff();
	};

	return (
		<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<DropdownMenuTrigger
				aria-label="editor menu"
				className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
			>
				<Menu className="h-4 w-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="w-56"
				ref={focusReturn.overlay.ref}
				// The ONE site that composes the close by hand instead of spreading it,
				// because it already owned this prop. The ORDER is the whole of it: a
				// hand-off wins outright and returns, so the canvas return never fires for a
				// close whose entire point was to give focus to the surface just opened. The
				// record a hand-off leaves standing is harmless — the ref above writes it
				// unconditionally on the next open rather than OR-ing into it.
				onCloseAutoFocus={(e) => {
					if (handingOff.current) {
						handingOff.current = false;
						e.preventDefault();
						return;
					}
					focusReturn.overlay.onCloseAutoFocus(e);
				}}
			>
				{/* The same verb set the world chip, the drawer and ⌘S drive — one action
            source, three surfaces. Every disabled state here means something specific
            and says so IN its label, because a disabled item swallows the tooltip that
            would otherwise carry it: New and Save are busy-gated (New empties the
            host's world SYNCHRONOUSLY, so one landing mid-save would write the
            freshly-emptied world over the named target), Bake and Make default need a
            name on disk to write about. */}
				<RegistrySubmenu group="world" />
				{/* Undo/Redo step the field's ONE history and are NAMED — "Undo segment fill",
            not "Undo" — off the history seam's own top-of-stack label. Duplicate, Move
            and Delete name the stamp they would act on, which is what a menu is for:
            their chords (⌘J, G, ⌫) act on whatever is selected without saying so.
            History… summons that same history as a list. */}
				<RegistrySubmenu group="edit" />
				{/* Twelve rows, the longest of the three, and the way out of the menu is its
            first: everything else about the view lives in the popover the door below
            opens, which can show seven layer gates and a slider without becoming a menu.

            Shading is stated as "Normals" rather than as a Studio/Normals pair — a
            menu checkbox is a boolean, and the boolean that means something is
            "am I in the debug mode". */}
				<RegistrySubmenu group="view" />
				<DropdownMenuSeparator />
				{/* Named after the surface it opens (the popover's trigger says "view
            options" too), not after what is in it: the popover calls those gates
            "layers", and a menu item calling them something else would be two names
            for one thing. TOP LEVEL rather than inside the View submenu, because it is a
            door out of this menu rather than one of the view's own verbs — the same place
            "Keyboard shortcuts" sits, for the same reason. */}
				<DropdownMenuItem
					onSelect={() => {
						// The popover inherits THIS menu's answer, so ☰ → View options… → Esc
						// still ends on the canvas when the journey started there.
						handOff();
						onOpenViewOptions();
					}}
				>
					View options…
				</DropdownMenuItem>
				{/* The way back from a palette closed with its × — without it the close
            button is a trap whose only exit is Reset Workspace. FLAT, and this is the
            half of the tree where the mid-gesture argument was honoured rather than
            overruled: the tick is the information, and a chevron would hide five
            answers behind one row. */}
				{PALETTE_IDS.map((id) => (
					<DropdownMenuCheckboxItem
						key={id}
						checked={palettes[id].open}
						// Opening is a SUMMON, not a toggle — the shared verb the status bar's
						// two chips and the Edit menu's History item all go through
						// (`usePaletteSummon`, where the four writes and their reasons live).
						// Closing is deliberately narrower and stays spelled out here: unticking
						// must not un-collapse or un-hide anything the user did not ask to change.
						onCheckedChange={(open) => {
							if (open) summon(id);
							else setOpen(id, false);
						}}
					>
						{PALETTES[id].title} palette
					</DropdownMenuCheckboxItem>
				))}
				<DropdownMenuSeparator />
				{/* The `help` group, rendered FLAT — one row, so a submenu here would be a
            chevron guarding a single item. The heading comes from `groupTitle` like the
            three triggers above, so the burger, the overlay and ⌘K cannot spell this
            section three ways.

            The item advertises `?` because `?` now runs it: the comment this replaces
            declined a keycap on the grounds that "an item advertising one nothing listens
            for is a shortcut that teaches a lie", and the holistic gate's ruling 3 made
            something listen. The keycap is read off the table, so it cannot outlive the
            matcher. */}
				<DropdownMenuGroup aria-labelledby="burger-group-help">
					<DropdownMenuLabel id="burger-group-help">
						{groupTitle("help")}
					</DropdownMenuLabel>
					{/* Hand-written for its FOCUS, not for its content — see this file's
              header. Load-bearing rather than symmetrical: this overlay carries no
              trigger for Radix to restore to, so without the forward its record is false
              for the menu route and dismissing it drops the user on `<body>`. The `?`
              route needs none of this — a keypress is its own gesture, and the dialog
              records it directly. */}
					<RegistryItems group="help" onSelect={handOff} />
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
