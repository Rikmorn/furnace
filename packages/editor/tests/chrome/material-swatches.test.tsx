// Registered FIRST — the chrome-wide rule (`tests/register-first.test.ts` enforces
// it): Radix resolves `globalThis.document` at module-evaluation time, and one file that
// reaches it before happy-dom exists pins the layout-effect shim to its no-op branch for
// the whole run.
import "../inspector/_register.ts";

// The MATERIAL STRIP's two rings, which are two different things wearing the same CSS
// property — and that collision is the whole reason this file exists.
//
//   - the SELECTION ring (`ring-2 ring-primary … ring-offset-1`) fires on `activeId`. Its
//     offset is load-bearing rather than decorative: a swatch's fill is an arbitrary material
//     colour, so a ring drawn flush against a blue-grey one is swallowed by it.
//   - the FOCUS ring is the house `focus-visible:ring-1 focus-visible:ring-ring` that every
//     control in the chrome wears (D-23's ONE focus vocabulary).
//
// They now differ in COLOUR as well as width, which they did not before the F4.5c holistic
// gate took `--ring` off `--primary`. That is a third way the pair can go wrong and it has its
// own test below.
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

test("the selected swatch's marker wears the SELECTION colour, not the focus one", () => {
	// The F4.5c holistic gate split the two tokens: `--ring` is a neutral of its own now and
	// `--primary` is selection. This marker fires on `activeId`, so it is SELECTION — and it
	// was spelled `ring-ring`, a borrowing that cost nothing for exactly as long as the two
	// tokens held the same value. Left alone, taking `--ring` off `--primary` would have
	// silently recoloured a selection marker on the way past, which is the class of change a
	// token move is most likely to make and least likely to be noticed making.
	renderStrip(1);
	const cls = screen.getByLabelText("material stone").className;
	// BOUNDED, for the reason the check further down already gave and this one had not taken:
	// a bare `toContain` passes on every token that merely STARTS with the one it names.
	// Measured — `ring-primary-foreground` (near-black at 0.15 L, an invisible marker on a
	// dark swatch), `ring-primary-hover`, `ring-primary/50` and `focus-visible:ring-primary`
	// each left this file and its two token siblings at 31 pass / 0 fail.
	//
	// The `(?:^| )` head is what keeps `focus-visible:ring-primary` out — a spelling that
	// would put the SELECTION colour on the FOCUS state, which is the exact swap D-23 now
	// forbids. The tail is `design-tokens.test.ts`'s `(?![\w-])` idiom plus `/`, and the `/`
	// is the one deviation from it: that file's scans HUNT a bare token, so matching
	// `text-primary/50` too is right there, while this one ASSERTS the marker is present and
	// a half-opacity marker is not the one that was measured. Same rule as the `-foreground`
	// fade ban next door — full opacity is checkable, "how faded is too faded" is not.
	expect(/(?:^| )ring-primary(?![\w-/])/.test(cls)).toBe(true);
	// The focus colour still has to be here, under its own variant. The two coexist on one
	// element — tailwind-merge keeps both because the modifier differs even though the utility
	// group does not.
	//
	// WHAT THAT ACTUALLY RENDERS AS, since the obvious reading is wrong and the first draft of
	// this comment took it: the two do NOT layer. `.ring-primary` and
	// `.focus-visible\:ring-ring:focus-visible` both write `--tw-ring-color` on the SAME
	// element, and Tailwind emits ONE `--tw-ring-shadow` layer off it — so while the swatch is
	// focused, `:focus-visible` outranks the plain class and the WHOLE ring paints `--ring`.
	// `--primary` is not on screen at that moment. The offset gap is unaffected either way: it
	// is `--tw-ring-offset-color`, i.e. `--background`. So during focus the selection cue is
	// ring WIDTH (4 px against an unselected swatch's 1) plus that gap, not colour — which is
	// the same collision the file header reasons about for width, seen from colour's side.
	// REASONED from the built CSS (`dist/frontend/chunk-*.css`) and the specificity rule, not
	// pixel-proven: happy-dom resolves no styles, so nothing here can see a painted ring.
	expect(cls).toContain("focus-visible:ring-ring");
	// …and the marker itself must not name the focus colour bare. The `(?:^| )` is what keeps
	// `focus-visible:ring-ring` out of this match: there the token follows a colon.
	expect(/(?:^| )ring-ring(?: |$)/.test(cls)).toBe(false);
});

test("an unselected swatch keeps the house 1 px focus ring", () => {
	// The wider ring is scoped to the selected swatch, so the rest of the strip still
	// speaks D-23's ONE focus vocabulary rather than inventing a second one.
	renderStrip(1);
	const other = screen.getByLabelText("material brick");
	expect(ringWidth(other.className, "focus-visible:")).toBe(1);
	expect(ringWidth(other.className, "")).toBeNull();
});
