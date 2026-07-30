// The shell's top bar: 40 px, opaque, and NEVER resized by anything in the viewport.
// Its height is one half of the canvas cell's inset budget (the status bar is the
// other), so a palette opening or a selection changing cannot move it.
import {
	useWorkspaceActions,
	useWorkspaceState,
} from "../../hooks/useWorkspace.tsx";
import { Button } from "../ui/button.tsx";
import { BurgerMenu } from "./BurgerMenu.tsx";

export function TopBar() {
	const { hidden } = useWorkspaceState();
	const { toggleHidden } = useWorkspaceActions();

	return (
		<header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
			<BurgerMenu />
			{/* MIGRATION (until Task 8 of the F4.5a plan): a placeholder chip. The world
          name + dirty dot come from the lifted world state; today the field host holds
          an unnamed world until the toolbar's Save gives it one. */}
			<span className="flex items-center gap-1.5 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
				untitled
			</span>
			<div className="flex-1" />
			{/* MIGRATION (until Task 8 of the F4.5a plan): inert until the bake flow moves
          out of the field toolbar. Disabled rather than dead — see BurgerMenu. */}
			<Button type="button" size="sm" variant="secondary" disabled>
				Bake
			</Button>
			{/* A BUTTON, not the hint it started as: the chord is live now, and the
          affordance that advertises it may as well perform it — a keycap you cannot
          click is a worse version of a control that teaches its own shortcut. The
          label follows the state, which is the one reason this bar reads it. */}
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-7 px-2 font-normal text-muted-foreground text-xs"
				onClick={toggleHidden}
			>
				⌘\ {hidden ? "show" : "hide"} palettes
			</Button>
		</header>
	);
}
