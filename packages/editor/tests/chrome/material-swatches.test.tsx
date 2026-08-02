// Registered FIRST — the chrome-wide rule (`tests/chrome-register-first.test.ts` enforces
// it): Radix resolves `globalThis.document` at module-evaluation time, and one file that
// reaches it before happy-dom exists pins the layout-effect shim to its no-op branch for
// the whole run.
import "../inspector/_register.ts";

// The MATERIAL STRIP's two rings, which are two different things wearing the same CSS
// property — and that collision is the whole reason this file exists.
//
//   - the SELECTION ring (`ring-2 … ring-offset-1`) fires on `activeId`. Its offset is
//     load-bearing rather than decorative: a swatch's fill is an arbitrary material colour,
//     so a ring drawn flush against a blue-grey one is swallowed by it.
//   - the FOCUS ring is the house `focus-visible:ring-1` that every control in the chrome
//     wears (D-23's ONE focus vocabulary).
//
// Both set `--tw-ring-width`, and `:focus-visible` outranks a plain class on specificity —
// so before F4.5c Task 13's review round, focusing the SELECTED swatch made its ring go
// 2 px → 1 px. Focus made the indicator SMALLER, which is the opposite of what a focus
// indicator is for, and no amount of reading either class string in isolation shows it.
//
// happy-dom resolves no styles, so this cannot measure a painted ring. What it can do is
// read the className `cn()` actually produced and check the widths against each other,
// which is where the outcome is decided: `cn()` runs tailwind-merge on every render, so the
// same-variant conflict is resolved at call time and the surviving `focus-visible:ring-N`
// is the one that reaches the DOM.
import { afterEach, expect, test } from "bun:test";
import { MaterialSwatches } from "../../src/frontend/components/field/MaterialSwatches.tsx";
import { TooltipProvider } from "../../src/frontend/components/ui/tooltip.tsx";
import { cleanup, render, screen } from "../inspector/_harness.tsx";

afterEach(cleanup);

const CLASSES = [
	{ id: 1, name: "stone", kind: "solid", color: [0.5, 0.5, 0.5, 1] },
	{ id: 2, name: "brick", kind: "kit", color: [0.6, 0.2, 0.2, 1] },
] as unknown as Parameters<typeof MaterialSwatches>[0]["classes"];

function renderStrip(activeId: number, disableKit = false) {
	render(
		<TooltipProvider>
			<MaterialSwatches
				classes={CLASSES}
				activeId={activeId}
				disableKit={disableKit}
				onSelect={() => {
					/* selection is driven by the `activeId` prop here — these tests are about
					   what the two rings render as, not about the click path */
				}}
			/>
		</TooltipProvider>,
	);
}

/** The `ring-N` width a class string ends up with for a given variant prefix, or null when
 *  that variant sets none. Reads the FINAL string, so a width tailwind-merge dropped is
 *  correctly reported as absent. */
function ringWidth(className: string, prefix: string): number | null {
	const m = className.match(new RegExp(`(?:^| )${prefix}ring-(\\d+)(?: |$)`));
	return m === null ? null : Number(m[1]);
}

test("focus never NARROWS the selected swatch's ring", () => {
	renderStrip(1);
	const selected = screen.getByLabelText("material stone");
	const cls = selected.className;

	// The fixture has to actually be the selected one, or every check below is vacuous.
	expect(cls).toContain("ring-offset-1");
	const selectionRing = ringWidth(cls, "");
	const focusRing = ringWidth(cls, "focus-visible:");
	expect(selectionRing).toBe(2);
	// THE INVARIANT. A null focus width would mean the selected swatch has no focus
	// indicator at all, which is the other way to fail this.
	expect(focusRing).not.toBeNull();
	expect(focusRing as number).toBeGreaterThan(selectionRing as number);
});

test("an unselected swatch keeps the house 1 px focus ring", () => {
	// The wider ring is scoped to the selected swatch, so the rest of the strip still
	// speaks D-23's ONE focus vocabulary rather than inventing a second one.
	renderStrip(1);
	const other = screen.getByLabelText("material brick");
	expect(ringWidth(other.className, "focus-visible:")).toBe(1);
	expect(ringWidth(other.className, "")).toBeNull();
});
