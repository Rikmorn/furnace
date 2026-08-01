// The top bar's one menu. The TREE is the deliverable here — the shape a user (and the
// shortcut overlay) can read the editor's verbs off — not the wiring.
//
// The World, Edit and View groups are RENDERED FROM THE ACTION REGISTRY
// (`lib/actions.ts`): their labels, their disabled states and the chords beside them all
// come from the same table the window key dispatcher reads, so a menu item and its
// shortcut cannot describe different things. The `tool` and `session` groups are
// deliberately NOT here — arming a brush and ending a session are the rail's and the
// viewport's, and the shortcuts overlay is where they are discovered.
//
// What stays hand-written is what a registry action cannot express, because its state is
// COMPONENT-LOCAL: the palette checkbox list (one item per palette id), "View options…"
// and "Keyboard shortcuts" (both open a surface and hand focus to it — see `handingOff`).
// An action's `run` must be expressible from the ctx; a menu item that drives a dialog's
// own open flag is not an action, and pretending otherwise would put a `setState` into a
// pure table.
import { Menu } from "lucide-react";
import { useRef, useState } from "react";
import { useActionContext } from "../../hooks/useActionContext.tsx";
import { usePaletteSummon } from "../../hooks/usePaletteStack.tsx";
import {
	useWorkspaceActions,
	useWorkspaceState,
} from "../../hooks/useWorkspace.tsx";
import { ACTION_GROUPS, ACTIONS, type ActionGroup } from "../../lib/actions.ts";
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
	DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";

/** One registry group, rendered in table order. Its own component so the action context
 *  — which moves on every op and every drag frame — is read inside the menu CONTENT:
 *  Radix mounts that content only while the menu is open, so a closed menu costs nothing
 *  and the trigger sitting in the top bar never re-renders with it.
 *
 *  `DropdownMenuGroup` + `aria-labelledby` is what ASSOCIATES the heading with its items;
 *  a bare `DropdownMenuLabel` beside them is a heading a screen reader announces once and
 *  then leaves behind, so every item below it is unattributed. */
function RegistryGroup({ group }: { group: ActionGroup }) {
	const ctx = useActionContext();
	const labelId = `burger-group-${group}`;
	// The registry's own name for the set — the same string the shortcuts overlay and the
	// command palette head their sections with. `find` cannot miss: `ACTION_GROUPS` covers
	// every member of the union (asserted in tests/actions.test.ts).
	const title = ACTION_GROUPS.find((g) => g.id === group)?.title;
	return (
		<DropdownMenuGroup aria-labelledby={labelId}>
			<DropdownMenuLabel id={labelId}>{title}</DropdownMenuLabel>
			{ACTIONS.filter((a) => a.group === group).map((action) => {
				// The chord rides BOTH branches: a checkbox action with a `keys` would
				// otherwise lose it silently, and `view.togglePalettes` is one keycap away
				// from being exactly that.
				const chord = action.keys !== undefined && (
					<DropdownMenuShortcut>{action.keys}</DropdownMenuShortcut>
				);
				// `title` is shown only where it can be READ: a disabled item carries
				// `pointer-events-none`, so it never surfaces a native tooltip — which is
				// why an action whose reason applies while DISABLED puts it in the label
				// instead (world.bake, edit.history).
				const disabled = !action.enabled(ctx);
				// A checkbox item where the action reports a checked state, a plain item
				// otherwise — the one structural difference a menu needs from the table.
				return action.checked === undefined ? (
					<DropdownMenuItem
						key={action.id}
						disabled={disabled}
						title={action.menuTitle}
						onSelect={() => action.run(ctx)}
					>
						{action.label(ctx)}
						{chord}
					</DropdownMenuItem>
				) : (
					<DropdownMenuCheckboxItem
						key={action.id}
						checked={action.checked(ctx)}
						disabled={disabled}
						title={action.menuTitle}
						onCheckedChange={() => action.run(ctx)}
					>
						{action.label(ctx)}
						{chord}
					</DropdownMenuCheckboxItem>
				);
			})}
		</DropdownMenuGroup>
	);
}

export function BurgerMenu({
	onOpenViewOptions,
}: {
	/** Open the View popover next door — the menu's way into the layer gates, which are
	 *  too many to carry as items (see the View group below). */
	onOpenViewOptions: () => void;
}) {
	const { palettes } = useWorkspaceState();
	const { setOpen } = useWorkspaceActions();
	const summon = usePaletteSummon();
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	// Radix returns focus to the trigger when the menu closes, which for an item that
	// OPENS something would pull focus straight back out of the surface just opened. This
	// flag marks the one close that is a hand-off, and the content skips its focus return
	// for it; every other close still puts focus back on the burger, where a keyboard user
	// expects it.
	const handingOff = useRef(false);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label="editor menu"
					className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
				>
					<Menu className="h-4 w-4" />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="w-56"
					onCloseAutoFocus={(e) => {
						if (!handingOff.current) return;
						handingOff.current = false;
						e.preventDefault();
					}}
				>
					{/* The same verb set the world chip, the drawer and ⌘S drive — one action
	            source, three surfaces. Every disabled state here means something specific
	            and says so IN its label, because a disabled item swallows the tooltip that
	            would otherwise carry it: New and Save are busy-gated (New empties the
	            host's world SYNCHRONOUSLY, so one landing mid-save would write the
	            freshly-emptied world over the named target), Bake and Make default need a
	            name on disk to write about. */}
					<RegistryGroup group="world" />
					<DropdownMenuSeparator />
					{/* Undo/Redo step the field's ONE history and are NAMED — "Undo segment fill",
	            not "Undo" — off the history seam's own top-of-stack label. Duplicate, Move
	            and Delete name the stamp they would act on, which is what a menu is for:
	            their chords (⌘J, G, ⌫) act on whatever is selected without saying so.
	            History… summons that same history as a list. */}
					<RegistryGroup group="edit" />
					<DropdownMenuSeparator />
					{/* The display toggles the menu carries, plus the two workspace verbs;
	            everything else about the view lives in the popover beside the world chip,
	            which can show seven layer gates and a slider without becoming a menu.
	            These are here because they are the ones a user reaches for mid-gesture.

	            Shading is stated as "Normals" rather than as a Studio/Normals pair — a
	            menu checkbox is a boolean, and the boolean that means something is
	            "am I in the debug mode". */}
					<RegistryGroup group="view" />
					{/* Named after the surface it opens (the popover's trigger says "view
	            options" too), not after what is in it: the popover calls those gates
	            "layers", and a menu item calling them something else would be two names
	            for one thing. */}
					<DropdownMenuItem
						onSelect={() => {
							handingOff.current = true;
							onOpenViewOptions();
						}}
					>
						View options…
					</DropdownMenuItem>
					{/* The way back from a palette closed with its × — without it the close
	            button is a trap whose only exit is Reset Workspace. */}
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
					<DropdownMenuLabel>Help</DropdownMenuLabel>
					{/* No shortcut of its own: `?` is a bare key the registry does not bind, and
					    an item advertising one nothing listens for is a shortcut that teaches a
					    lie. */}
					<DropdownMenuItem
						onSelect={() => {
							handingOff.current = true;
							setShortcutsOpen(true);
						}}
					>
						Keyboard shortcuts
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{/* Outside the menu, and it has to be: the menu unmounts its content on close, so
			    a dialog rendered inside would be torn down by the very click that opened it. */}
			<ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
		</>
	);
}
