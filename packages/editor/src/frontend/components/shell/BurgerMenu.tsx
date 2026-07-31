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
import { usePaletteRaise } from "../../hooks/usePaletteStack.tsx";
import {
	useWorkspaceActions,
	useWorkspaceState,
} from "../../hooks/useWorkspace.tsx";
import { ACTIONS, type ActionGroup } from "../../lib/actions.ts";
import { PALETTE_IDS, PALETTES } from "../../lib/palette-store.ts";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";

const MAKE_DEFAULT_TITLE =
	"point the game at the SAVED copy of this world — Bake if you want the edits in this session to go with it";

/** The per-item title a registry action gets, where a disabled item would otherwise
 *  swallow its own explanation. Keyed by id rather than carried on the table because it
 *  is a MENU concern — the same action reached by its chord has no tooltip. */
const ITEM_TITLES: Record<string, string> = {
	"world.makeDefault": MAKE_DEFAULT_TITLE,
	"edit.history": "arrives with the History palette",
};

/** One registry group, rendered in table order. Its own component so the action context
 *  — which moves on every op and every drag frame — is read inside the menu CONTENT:
 *  Radix mounts that content only while the menu is open, so a closed menu costs nothing
 *  and the trigger sitting in the top bar never re-renders with it. */
function RegistryGroup({
	group,
	title,
}: {
	group: ActionGroup;
	title: string;
}) {
	const ctx = useActionContext();
	return (
		<>
			<DropdownMenuLabel>{title}</DropdownMenuLabel>
			{ACTIONS.filter((a) => a.group === group).map((action) => {
				const item = {
					disabled: !action.enabled(ctx),
					title: ITEM_TITLES[action.id],
				};
				// A checkbox item where the action reports a checked state, a plain item
				// otherwise — the one structural difference a menu needs from the table.
				return action.checked === undefined ? (
					<DropdownMenuItem
						key={action.id}
						disabled={item.disabled}
						title={item.title}
						onSelect={() => action.run(ctx)}
					>
						{action.label(ctx)}
						{action.keys !== undefined && (
							<DropdownMenuShortcut>{action.keys}</DropdownMenuShortcut>
						)}
					</DropdownMenuItem>
				) : (
					<DropdownMenuCheckboxItem
						key={action.id}
						checked={action.checked(ctx)}
						disabled={item.disabled}
						title={item.title}
						onCheckedChange={() => action.run(ctx)}
					>
						{action.label(ctx)}
					</DropdownMenuCheckboxItem>
				);
			})}
		</>
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
	const { setOpen, setCollapsed, setHidden } = useWorkspaceActions();
	const raise = usePaletteRaise();
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
					<RegistryGroup group="world" title="World" />
					<DropdownMenuSeparator />
					{/* Undo/Redo step the field's ONE history, and are NAMED once the history
	            seam reports what a step did. Duplicate, Move and Delete name the stamp
	            they would act on — which is what a menu is for, since their chords
	            (⌘J, G, ⌫) act on whatever is selected without saying so. */}
					<RegistryGroup group="edit" title="Edit" />
					<DropdownMenuSeparator />
					{/* The display toggles the menu carries, plus the two workspace verbs;
	            everything else about the view lives in the popover beside the world chip,
	            which can show seven layer gates and a slider without becoming a menu.
	            These are here because they are the ones a user reaches for mid-gesture.

	            Shading is stated as "Normals" rather than as a Studio/Normals pair — a
	            menu checkbox is a boolean, and the boolean that means something is
	            "am I in the debug mode". */}
					<RegistryGroup group="view" title="View" />
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
							// Opening is a SUMMON, not a toggle: matches the ⚠ chip's onClick
							// (StatusBar.tsx) — `open` alone does not mean "readable". A palette
							// closed while collapsed comes back collapsed, and the ⌘\ latch covers
							// the whole layer, so a tick that only sets `open` can re-open a rail
							// chip or a still-latched-hidden palette that renders nothing. Raising
							// is unconditional for the same reason as the chip: this is very often
							// already open and merely buried, and buried has no open transition for
							// the layer's safety net to catch. Closing is deliberately narrower —
							// unticking shouldn't un-collapse or un-hide anything the user didn't ask
							// to change.
							onCheckedChange={(open) => {
								setOpen(id, open);
								if (open) {
									setCollapsed(id, false);
									setHidden(false);
									raise(id);
								}
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
