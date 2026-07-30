// The top bar's one menu. The TREE is the deliverable here — the shape a user (and the
// shortcut overlay) can read the editor's verbs off — not the wiring.
//
// Every item is LIVE: World acts on the session's world, Edit steps the field's one
// history, View drives the same state the popover beside it does, and Help opens the
// shortcut overlay. Nothing is a placeholder any more, so every disabled state below means
// something specific — no name on disk yet, a write in flight, nothing left to undo.
import { Menu } from "lucide-react";
import { useRef, useState } from "react";
import { useFieldHostState } from "../../hooks/useFieldHostState.tsx";
import { usePaletteRaise } from "../../hooks/usePaletteStack.tsx";
import { useViewActions, useViewState } from "../../hooks/useView.tsx";
import {
	useWorkspaceActions,
	useWorkspaceState,
} from "../../hooks/useWorkspace.tsx";
import { useWorldActions, useWorldState } from "../../hooks/useWorld.tsx";
import { PALETTE_IDS, PALETTES } from "../../lib/palette-store.ts";
import { useEditor } from "../editor-context.ts";
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

/** Undo / Redo, and whether there is anything to step.
 *
 *  Its own component so the STATS subscription lives inside the menu CONTENT: Radix
 *  mounts that content only while the menu is open, so a closed menu costs nothing at
 *  all — and the stats push (every rAF, guarded by value-equality but moving on every op
 *  of every drag) never re-renders the trigger sitting in the top bar.
 *
 *  The verbs go straight to the host, which is what the ⌘Z/⇧⌘Z chords do too (Shell's
 *  `undo`/`redo` callbacks are the same two lines): one history, one pair of methods,
 *  two surfaces. */
function EditGroup() {
	const { fieldHostRef } = useEditor();
	const { stats } = useFieldHostState();
	// No stats yet means the host has never pushed a frame — nothing has been done, so
	// there is provably nothing to step, and both items say so rather than inviting a
	// click into a host that may not even be up.
	const undoDepth = stats?.undoDepth ?? 0;
	const redoDepth = stats?.redoDepth ?? 0;

	return (
		<>
			<DropdownMenuLabel>Edit</DropdownMenuLabel>
			{/* MIGRATION (until F4.5b): the labels say only WHETHER there is something to
			    step, never WHAT. Naming the op ("Undo dig") needs the log's tail, which no
			    host seam exposes today; it arrives with the command registry. */}
			<DropdownMenuItem
				disabled={undoDepth === 0}
				onSelect={() => fieldHostRef.current?.undo()}
			>
				Undo
				<DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={redoDepth === 0}
				onSelect={() => fieldHostRef.current?.redo()}
			>
				Redo
				<DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
			</DropdownMenuItem>
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
	const { palettes, hidden } = useWorkspaceState();
	const { setOpen, toggleHidden, reset } = useWorkspaceActions();
	const raise = usePaletteRaise();
	const { name: worldName, busy } = useWorldState();
	const world = useWorldActions();
	const { shading, layers } = useViewState();
	const view = useViewActions();
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
	            source, three surfaces. Bake also writes worlds/index.json, so it needs a
	            name to write about: disabled while untitled, with the reason IN the label
	            (a disabled item swallows the tooltip that would otherwise carry it). */}
					<DropdownMenuLabel>World</DropdownMenuLabel>
					{/* Busy-gated like Save and Bake, and for a sharper reason than symmetry: New
					    empties the host's world SYNCHRONOUSLY, while an in-flight save is still
					    between `exportArtifact` and its uploads. Ungated, a New landing mid-save
					    writes the freshly-emptied world over the named target. (The drawer's New
					    is gated already; this is the surface that was missing it.) */}
					<DropdownMenuItem disabled={busy} onSelect={world.reset}>
						New
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => world.openDrawer("browse")}>
						Open…
					</DropdownMenuItem>
					<DropdownMenuItem disabled={busy} onSelect={world.save}>
						Save
						<DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => world.openDrawer("save-as")}>
						Save as…
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={busy || worldName === null}
						onSelect={world.bake}
					>
						{worldName === null ? "Bake — name the world first" : "Bake"}
					</DropdownMenuItem>
					{/* The drawer carries this verb per ROW; here it acts on the world already
					    open, which is the case that otherwise costs a trip through the list. It
					    is NOT a second spelling of Bake: Bake writes this session over the
					    directory first, this one leaves the saved copy exactly as it is and only
					    repoints worlds/index.json. Not busy-gated — it touches neither the host
					    nor the in-flight upload (see useWorld's note on the world verbs not
					    being serialised against each other). */}
					<DropdownMenuItem
						disabled={worldName === null}
						title={MAKE_DEFAULT_TITLE}
						onSelect={() => {
							if (worldName !== null) world.makeDefault(worldName);
						}}
					>
						{worldName === null
							? "Make default — name the world first"
							: "Make default"}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<EditGroup />
					<DropdownMenuSeparator />
					<DropdownMenuLabel>View</DropdownMenuLabel>
					{/* The two display toggles the menu carries; everything else about the view
	            lives in the popover beside the world chip, which can show seven layer
	            gates and a slider without becoming a menu. These two are here because
	            they are the ones a user reaches for mid-gesture: the debug shading and
	            the grid.

	            Shading is stated as "Normals" rather than as a Studio/Normals pair — a
	            menu checkbox is a boolean, and the boolean that means something is
	            "am I in the debug mode". */}
					<DropdownMenuCheckboxItem
						checked={shading === "normals"}
						onCheckedChange={(on) => view.setShading(on ? "normals" : "studio")}
					>
						Normals shading
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem
						checked={layers.grid}
						onCheckedChange={(grid) => view.setLayers({ ...layers, grid })}
					>
						Grid
					</DropdownMenuCheckboxItem>
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
							// Opening RAISES, unconditionally — re-ticking a box for a palette that
							// is open but buried is a summon too, and it has no transition for the
							// layer's safety net to catch.
							onCheckedChange={(open) => {
								setOpen(id, open);
								if (open) raise(id);
							}}
						>
							{PALETTES[id].title} palette
						</DropdownMenuCheckboxItem>
					))}
					<DropdownMenuItem onSelect={toggleHidden}>
						{hidden ? "Show palettes" : "Hide palettes"}
						<DropdownMenuShortcut>⌘\</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={reset}>Reset workspace</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuLabel>Help</DropdownMenuLabel>
					{/* No shortcut of its own: the four global chords are the whole bare-key
					    budget this build spends (lib/keybindings.ts), and an item advertising a
					    "?" nothing listens for is a shortcut that teaches a lie. */}
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
