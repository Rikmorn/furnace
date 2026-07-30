// The shell's top bar: 40 px, opaque, and NEVER resized by anything in the viewport.
// Its height is one half of the canvas cell's inset budget (the status bar is the
// other), so a palette opening or a selection changing cannot move it.
import { Button } from "../ui/button.tsx";
import { BurgerMenu } from "./BurgerMenu.tsx";

export function TopBar() {
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
			{/* MIGRATION (until Task 6 of the F4.5a plan): the hint is ahead of its
          binding — ⌘\ lands with the palette layer that has something to hide. Dimmed
          and aria-disabled until then, by BurgerMenu's own rule: advertising a chord
          that does nothing is the same failure as a live-looking dead menu item. */}
			<span
				aria-disabled="true"
				className="text-xs text-muted-foreground opacity-50"
			>
				⌘\ hide panels
			</span>
		</header>
	);
}
