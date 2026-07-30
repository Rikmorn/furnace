// The shell's top bar: 40 px, opaque, and NEVER resized by anything in the viewport.
// Its height is one half of the canvas cell's inset budget (the status bar is the
// other), so a palette opening or a selection changing cannot move it.
//
// It carries the WORLD CHIP — which world this session is editing, whether it has
// unsaved edits, and the way into the drawer that changes either. The drawer is mounted
// here rather than in the shell frame because it is summoned from the chip and portals
// out of the bar anyway; keeping the pair together keeps the world state out of the
// component that builds the palette bodies.
import { useState } from "react";
import {
	useWorkspaceActions,
	useWorkspaceState,
} from "../../hooks/useWorkspace.tsx";
import { useWorldActions, useWorldState } from "../../hooks/useWorld.tsx";
import { ReasonTip } from "../field/form-bits.tsx";
import { Button } from "../ui/button.tsx";
import { BurgerMenu } from "./BurgerMenu.tsx";
import { ViewPopover } from "./ViewPopover.tsx";
import { WorldDrawer } from "./WorldDrawer.tsx";

const UNTITLED_REASON = "name the world first — ⌘S";

/** Which world, and whether it is saved. A BUTTON, because the answer to both questions
 *  is the drawer: the chip that reports the state is the handle that changes it. */
function WorldChip() {
	const { name, dirty, drawer } = useWorldState();
	const { openDrawer } = useWorldActions();
	return (
		<button
			type="button"
			onClick={() => openDrawer("browse")}
			aria-expanded={drawer !== null}
			className="flex items-center gap-1.5 rounded-sm bg-muted px-2 py-0.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
		>
			{/* The dot carries no text of its own — the sr-only clause below is what says
          it, so the state reaches a screen reader as part of the button's NAME rather
          than as a coloured pixel nobody announces. */}
			{dirty && (
				<span
					aria-hidden="true"
					className="h-[7px] w-[7px] rounded-full bg-warning"
				/>
			)}
			<span className="font-mono">{name ?? "untitled"}</span>
			{dirty && <span className="sr-only">— unsaved changes</span>}
			<span aria-hidden="true">▾</span>
		</button>
	);
}

export function TopBar() {
	const { hidden } = useWorkspaceState();
	const { toggleHidden } = useWorkspaceActions();
	const { name, busy } = useWorldState();
	const { bake } = useWorldActions();
	// CONTROLLED, because the burger's "View options…" opens it: the two surfaces sit side
	// by side in this bar, and the menu item is how someone who has not yet worked out what
	// the ⬒ chip is finds the layer gates behind it.
	const [viewOpen, setViewOpen] = useState(false);

	return (
		<header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
			<BurgerMenu onOpenViewOptions={() => setViewOpen(true)} />
			<WorldChip />
			<WorldDrawer />
			{/* Beside the world chip, because they answer the two questions a user asks of
          the bar: WHICH world is this, and what am I looking at. */}
			<ViewPopover open={viewOpen} onOpenChange={setViewOpen} />
			<div className="flex-1" />
			{/* Bake writes worlds/index.json as well as the world, so it needs a name to
          write about. Disabled rather than silently substituting a save-as: the two
          verbs commit to different things. */}
			<ReasonTip reason={name === null ? UNTITLED_REASON : undefined}>
				<Button
					type="button"
					size="sm"
					variant="secondary"
					disabled={busy || name === null}
					onClick={bake}
				>
					Bake
				</Button>
			</ReasonTip>
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
