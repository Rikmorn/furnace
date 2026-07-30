// The top bar's one menu. The TREE is the deliverable here — the shape a user (and
// the shortcut overlay) can read the editor's verbs off — not the wiring.
//
// MIGRATION (until F4.5b): every item is inert and rendered DISABLED rather than
// silently dead, because a live-looking item that does nothing is worse than an
// obviously unavailable one. What wires each group: World → the world flows (open/
// save/new/bake), View → the view popover (shading + grid), Help → the shortcut
// overlay.
import { Menu } from "lucide-react";
import {
	DropdownMenu,
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
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="editor menu"
				className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
			>
				<Menu className="h-4 w-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuLabel>World</DropdownMenuLabel>
				<PendingItem label="New" />
				<PendingItem label="Open…" />
				<PendingItem label="Save" shortcut="⌘S" />
				<PendingItem label="Bake" />
				<DropdownMenuSeparator />
				<DropdownMenuLabel>View</DropdownMenuLabel>
				<PendingItem label="Shading" />
				<PendingItem label="Grid" />
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Help</DropdownMenuLabel>
				<PendingItem label="Keyboard shortcuts" shortcut="?" />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
