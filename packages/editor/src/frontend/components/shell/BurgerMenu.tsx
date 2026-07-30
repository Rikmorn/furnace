// The top bar's one menu. The TREE is the deliverable here — the shape a user (and
// the shortcut overlay) can read the editor's verbs off — not the wiring.
//
// Items wire up group by group as their owning task lands, so the menu is a mix: the
// World and workspace verbs are LIVE, and everything still waiting is rendered DISABLED
// rather than silently dead, because a live-looking item that does nothing is worse
// than an obviously unavailable one. Each group carries its own MIGRATION marker at its
// render site, because each is wired by a different task — one marker for the file would
// outlive two thirds of what it describes.
import { Menu } from "lucide-react";
import { usePaletteRaise } from "../../hooks/usePaletteStack.tsx";
import { useViewActions, useViewState } from "../../hooks/useView.tsx";
import {
	useWorkspaceActions,
	useWorkspaceState,
} from "../../hooks/useWorkspace.tsx";
import { useWorldActions, useWorldState } from "../../hooks/useWorld.tsx";
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

/** One inert entry: disabled, so the menu reads as a map of what is coming rather than
 *  a set of buttons that swallow clicks. */
function PendingItem({
	label,
	shortcut,
}: {
	label: string;
	shortcut?: string;
}) {
	return (
		<DropdownMenuItem disabled>
			{label}
			{shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
		</DropdownMenuItem>
	);
}

export function BurgerMenu() {
	const { palettes, hidden } = useWorkspaceState();
	const { setOpen, toggleHidden, reset } = useWorkspaceActions();
	const raise = usePaletteRaise();
	const { name: worldName, busy } = useWorldState();
	const world = useWorldActions();
	const { shading, layers } = useViewState();
	const view = useViewActions();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="editor menu"
				className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
			>
				<Menu className="h-4 w-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
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
				{/* MIGRATION (until Task 11 of the F4.5a plan): the shortcut overlay wires
            this one. */}
				<DropdownMenuLabel>Help</DropdownMenuLabel>
				<PendingItem label="Keyboard shortcuts" shortcut="?" />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
