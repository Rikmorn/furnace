import { useEffect, useRef } from "react";
import type { ClaimLost } from "../hooks/useSessionClaim.ts";
import { worldPhrase } from "../lib/humanize.ts";
import { Button } from "./ui/button.tsx";

/**
 * What a tab sees after ANOTHER editor session takes the world it was authoring
 * (foundations T4b). A terminal state, said terminally: a full-viewport cover that no
 * gesture dismisses, over a chrome that is still fully rendered behind it.
 *
 * WHY A BLOCKING COVER RATHER THAN READ-ONLY, which is the other half of the settled
 * policy ("a second tab gets read-only or an explicit steal"). This tranche ships steal
 * + this cover and NOT a read-only mode, and the narrowing is declared here because
 * here is where a reader meets it. Read-only is not a flag: it is a per-control decision
 * across the whole shell — which verbs are refused, what a refused control says, whether
 * the viewport still digs, what happens to a gesture already in progress — and half of it
 * would be worse than none, for the reason `tests/frontend-overlay-focus-return.test.ts`
 * states about an inconsistent focus rule. A cover is honest about the whole tab at
 * once. The filing carries the trigger:
 * `docs/backlog/editor-and-tooling/read-only-chrome-for-an-unclaimed-session.md`.
 *
 * NO ESCAPE, NO OVERLAY CLICK, NO ✕ — deliberately not the `ConfirmDialog` shape. Every
 * other overlay in this chrome is a question; this one is a report about a state the tab
 * cannot argue with, and a dismissal would leave a session that LOOKS live, still takes
 * digs, and is reachable by nobody. The one way out is the one control it offers, which
 * re-runs the boot that claims (`useSessionClaim`). Reloading discards unsaved edits like
 * any other reload — said on the cover, since a user who did not expect to lose the tab
 * deserves to be told before pressing the only button on it.
 *
 * **A COVER IS TERMINAL IN THREE CHANNELS AND GETS ONE OF THEM FREE.** The pointer is the
 * free one: a `fixed inset-0` layer eats every click by existing. The other two are built,
 * and neither was there when this docblock first claimed the word "terminal":
 *
 * - **The window keyboard.** ⌘K, ⌘S, ⌘Z and every tool letter dispatch from a listener on
 *   the WINDOW, which never saw a layer — so they kept firing behind the cover, ⌘K's
 *   palette being itself a portalled dialog, i.e. this file's z-index note happening.
 *   `useGlobalKeybindings` reads `claimLostRef` and returns before it matches anything.
 * - **Focus.** TAB ORDER FOLLOWS DOM ORDER AND Z-INDEX DOES NOT TOUCH IT. `<Shell />` is
 *   still mounted behind this, with real buttons in the top bar and status bar, so Tab off
 *   "Reload" walked into the shell and ⏎ invoked that button's own `onClick` — a path the
 *   window-listener guard cannot see, because it is not a keybinding at all. The focus
 *   trap in the effect below closes it.
 *
 * Only the pointer channel is closed by declaration. `aria-modal="true"` is what tells
 * assistive tech to ignore the rest of the document, and the residue is worth naming: it
 * is a DECLARATION, not the `inert`/`aria-hidden` enforcement Radix's `hideOthers` would
 * apply, so a virtual cursor may still reach shell content it cannot operate. Closing that
 * too means marking the shell subtree, which means either a wrapper element around
 * `<Shell />` (the layout contract at the top of `Shell.tsx` is exactly what one must not
 * disturb casually) or a component reaching out to mutate its own siblings.
 *
 * A PLAIN COVER RATHER THAN A RADIX `Dialog`, RE-PRICED — the first version of this
 * paragraph read "three behaviours to suppress against zero to add", and it was wrong
 * because it did not count the focus TRAP, the one Radix behaviour this surface actually
 * needed. The honest ledger: Radix's `DialogContent` brings dismissal (Escape, overlay
 * click, the ✕ this repo's wrapper renders), focus RESTORATION to a trigger that does not
 * exist here, and an exit animation for a close that can never happen — four to suppress —
 * against `FocusScope` and `hideOthers`, which is real. What decided it is that Radix's
 * layer is `z-50`, the same as the confirm dialog: two portalled dialogs at equal z resolve
 * by MOUNT ORDER, so the cover's whole reason for being above everything would become a
 * race. Given the z override was required anyway, the remaining trade was `FocusScope`
 * versus the effect below — and the effect can be PINNED BY A TEST THAT MOVES FOCUS, which
 * is what this fix was asked for. (`inert` on the shell was the other candidate and lost on
 * the same ground: happy-dom implements no `inert` semantics, so a pin written against it
 * would pass whether or not the attribute was there.)
 */
export function ClaimLostOverlay({ lost }: { lost: ClaimLost }) {
	// SPLIT SO THE COVER'S MOUNT *IS* THE CONDITION. This component is rendered from the
	// first frame of the editor's life with nothing to show, and the trap below must exist
	// exactly while the cover does. Written as one component that early-returns, the effect
	// would either run once against a `coverRef` that is still null (`[]`) or carry a
	// dependency its own body never reads (`[lost]`) — the first is a trap that never
	// installs, the second is a comment where a structure should be. A child that only
	// exists while there is something to cover needs neither.
	if (lost === null) return null;
	return <Cover world={lost.world} />;
}

function Cover({ world }: { world: string | null }) {
	const coverRef = useRef<HTMLDivElement>(null);
	const reloadRef = useRef<HTMLButtonElement>(null);

	// THE TRAP. A capture-phase `focusin` on the document: anything that takes focus
	// outside the cover hands it straight back to the one control the cover has.
	//
	// A BOUNCE RATHER THAN A BARRIER, which is what a focus scope is — Radix's does the
	// same thing — and it is complete in a way a Tab-key handler is not: it catches Tab
	// and ⇧Tab in both wrap directions, a programmatic `.focus()`, and whatever a browser
	// or assistive tech does that nobody enumerated. It cannot recurse: the `.focus()` it
	// performs raises a `focusin` whose target IS inside the cover, which returns.
	useEffect(() => {
		const cover = coverRef.current;
		if (cover === null) return;
		const pullBack = (e: FocusEvent) => {
			if (e.target instanceof Node && cover.contains(e.target)) return;
			reloadRef.current?.focus();
		};
		document.addEventListener("focusin", pullBack, true);
		return () => document.removeEventListener("focusin", pullBack, true);
	}, []);

	const what = worldPhrase(world);
	return (
		<div
			ref={coverRef}
			role="alertdialog"
			aria-modal="true"
			aria-label="claim lost"
			// `z-[60]`, ONE STEP ABOVE the control library's entire layer, and the step is
			// the whole reason it works. Every Radix overlay in `components/ui/` sits at
			// `z-50` AND portals to `document.body`, which is a sibling AFTER `#root` — so
			// a cover at `z-50` loses the tie on document order and paints beneath any open
			// confirm prompt or ⌘K palette. Reachable, not theoretical: a steal landing
			// while a delete-world confirm is up. Pinned in
			// `tests/chrome/session-claim.test.tsx`, which derives the layer's maximum from
			// `components/ui/` rather than hard-coding 50, so a library-wide raise reds here
			// instead of silently going over the top of this.
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
		>
			<div className="mx-4 max-w-sm rounded-lg border border-border bg-background p-6 text-center">
				<p className="text-sm font-medium text-foreground">
					Another editor session took over {what}.
				</p>
				<p className="mt-2 text-xs text-muted-foreground">
					This tab is no longer the editing session. Reload to claim it back —
					anything dug here since the last save is discarded.
				</p>
				<Button
					ref={reloadRef}
					// The keyboard has to be PUT on the one control, or a reader who was flying
					// the canvas meets a cover with focus still out in a shell they cannot use.
					// The usual objection to `autoFocus` — it steals focus from whatever the
					// reader was doing — is the POINT on a surface that has taken the tab away
					// from them; and `WorldDrawer`'s name field is the house precedent for a
					// surface whose one input is why it opened. The trap above is what keeps it
					// here; this is what puts it here in the first place.
					autoFocus
					className="mt-4"
					onClick={() => window.location.reload()}
				>
					Reload
				</Button>
			</div>
		</div>
	);
}
