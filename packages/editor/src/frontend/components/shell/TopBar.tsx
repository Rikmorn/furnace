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
import { useActionContext } from "../../hooks/useActionContext.tsx";
import { useFieldStamp } from "../../hooks/useFieldHostState.tsx";
import { useWorldActions, useWorldState } from "../../hooks/useWorld.tsx";
import { ACTIONS } from "../../lib/actions.ts";
import { ReasonTip } from "../field/form-bits.tsx";
import { Button } from "../ui/button.tsx";
import { BurgerMenu } from "./BurgerMenu.tsx";
import { SessionStrip } from "./SessionStrip.tsx";
import { ToolStrip } from "./ToolStrip.tsx";
import { ViewPopover } from "./ViewPopover.tsx";
import { WorldDrawer } from "./WorldDrawer.tsx";

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

/** The bar's middle: the armed tool's params, or — while a session stands — what that
 *  session is and how it ends (mock frames 1 and 2).
 *
 *  Its OWN component so `TopBar` does not read the session context: `subscribeStamp` pushes
 *  a clone on every nudge and every preview run, i.e. at pointer rate during a move, and a
 *  read one level up would re-render the burger menu, the world chip and the mounted world
 *  drawer with it. The `KeymapLine` precedent, one bar over. */
function TopBarStrip() {
	const { stamp } = useFieldStamp();
	return stamp === null ? <ToolStrip /> : <SessionStrip session={stamp} />;
}

/** Bake, and its disappearing act (mock frame 2).
 *
 *  Both facts come from the REGISTRY entry, never from a local rule: `world.bake.enabled`
 *  carries the session clause and `world.bake.label` carries the reason. The first cut had
 *  the clause here and only here, so the top bar hid the button while the burger's World
 *  group still offered it — the same hazard one menu click away, and two surfaces
 *  disagreeing about whether the verb exists.
 *
 *  HIDDEN rather than disabled while a session stands, and that is this surface's own call
 *  on top of the shared refusal: `exportArtifact` bakes from the COMMITTED field and op log
 *  (`bakeFieldWorld(store, log, …)`) and a live session's ghost is in neither, so the verb
 *  is not merely unavailable, it is about a different world than the one on screen. The
 *  menu keeps the item (a menu's job is to show the whole vocabulary, greyed, with the
 *  reason in the label); the bar spends its width on the session instead.
 *
 *  A leaf component for `TopBarStrip`'s reason — the session pushes at pointer rate. */
/** The ⌘\ latch, read from the registry like `BakeButton` beside it (D-12: one action
 *  table behind every key and every clickable that performs one). A BUTTON, not the hint
 *  it started as: the chord is live, and the affordance that advertises it may as well
 *  perform it — a keycap you cannot click is a worse version of a control that teaches
 *  its own shortcut.
 *
 *  Both halves of the caption come from the def: `label(ctx)` already computes
 *  "Show/Hide palettes" from `workspace.hidden`, and `keys` already carries "⌘\". This
 *  bar hardcoded both and called `toggleHidden()` directly until F4.5b Task 14 — three
 *  lines under a docblock arguing against exactly that. A leaf component for
 *  `BakeButton`'s reason: the ctx pushes at pointer rate. */
function PalettesButton() {
	const ctx = useActionContext();
	const def = ACTIONS.find((a) => a.id === "view.togglePalettes");
	if (def === undefined) return null;
	return (
		<Button
			type="button"
			size="sm"
			variant="ghost"
			className="h-7 shrink-0 px-2 font-normal text-muted-foreground text-xs"
			onClick={() => def.run(ctx)}
		>
			{def.keys} {def.label(ctx).toLowerCase()}
		</Button>
	);
}

function BakeButton() {
	const ctx = useActionContext();
	const def = ACTIONS.find((a) => a.id === "world.bake");
	if (def === undefined || ctx.session !== null) return null;
	const enabled = def.enabled(ctx);
	return (
		// The registry's label already states the reason ("Bake — name the world first"), so
		// the tooltip repeats it rather than inventing a second wording.
		<ReasonTip reason={enabled ? undefined : def.label(ctx)}>
			<Button
				type="button"
				size="sm"
				variant="secondary"
				disabled={!enabled}
				onClick={() => def.run(ctx)}
			>
				Bake
			</Button>
		</ReasonTip>
	);
}

export function TopBar() {
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
			<span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
			{/* The strip takes the free space itself (`flex-1` inside), so the bar has no
          separate spacer: two flex-1 siblings would split the width and halve the strip. */}
			<TopBarStrip />
			<BakeButton />
			<PalettesButton />
		</header>
	);
}
