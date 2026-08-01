// The full-window canvas layer: the one surface the FieldHost renders into, sized by
// the shell's layout contract rather than by any panel.
import { useEffect, useRef } from "react";
import type { FieldHost } from "../../../viewport-host/index.ts"; // type-only: erased
import { errorMessage } from "../../lib/humanize.ts";
import { useEditor } from "../editor-context.ts";

/**
 * Mounts the canvas and inits `host` on it. Init is EAGER — the dock-era
 * `initWhenSized` deferral is retired (D-1): this canvas is an absolute fill of a
 * layout cell whose height comes from two fixed-height bars, so it is sized by
 * construction at the first effect. A zero measure therefore isn't "not laid out yet",
 * it is the shell's CSS contract broken, and waiting for a resize that will never come
 * would hide it. Fail loud instead.
 *
 * `sampleCount` is the viewport's MSAA, and it is a CONTEXT property: the only way to
 * change it is to dispose the host and init it again, which is why the View popover's AA
 * switch lands here rather than on a host setter. The cost is a re-init, not a reset —
 * everything the editor cannot rebuild (the field, the op log, the tool, the camera) is
 * CPU state the host keeps across a dispose.
 *
 * `onError` carries an init REJECTION (a GPU/context failure) to the status bar —
 * local, not a global engine-error: the chrome is still usable and the message is the
 * only diagnosis a user gets.
 */
export function CanvasHost({
	host,
	sampleCount,
	onError,
}: {
	host: FieldHost;
	sampleCount: 1 | 4;
	onError: (message: string) => void;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	const { viewportFocusRef } = useEditor();
	// Did the canvas hold focus when the gesture now in progress began? See
	// {@link ViewportFocus.heldFocusAtGestureStart} for why the question is about the
	// gesture and not about this instant — the short version is that every overlay has
	// already taken focus by the time it can be asked.
	const heldAtGestureStart = useRef(false);
	// The tail of the LAST teardown, so the next init can wait for it. The host holds one
	// context and throws on a second `init`, and its dispose is deferred (see the cleanup
	// below) — so an AA change, whose cleanup and re-run happen in the same React commit,
	// would otherwise call `init` while the old context is still up and take the whole
	// tree down with "already initialized". Chaining is what makes re-init expressible at
	// all; it also happens to make a double-invoked mount safe, which the deferred dispose
	// alone did not.
	const teardown = useRef<Promise<unknown>>(Promise.resolve());

	// Latest-ref, because the effect below is a GPU LIFECYCLE: it must re-run for a new
	// host and for nothing else. With `onError` in its deps, a caller passing an inline
	// lambda would tear the WebGPU context down and rebuild it on every render — and
	// "pass a stable callback" is a contract no comment can enforce, so the dependency
	// is removed rather than documented. Written on every render (no dep array) so the
	// async `.catch` below always reaches the CURRENT handler, never a stale closure.
	const onErrorRef = useRef(onError);
	useEffect(() => {
		onErrorRef.current = onError;
	});

	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			const message =
				"CanvasHost: the canvas measured zero at mount — the shell's layout contract is broken";
			// Logged BEFORE the throw on purpose: there is no error boundary above this,
			// so the throw takes the whole tree down and the page goes blank. Without the
			// log the only diagnosis is a React stack in devtools, which is exactly where
			// someone staring at a blank editor is not looking.
			console.error(message);
			throw new Error(message);
		}
		let cancelled = false;
		const started = teardown.current
			.then(() => {
				// The teardown this waited on may have been THIS effect's own cleanup (an AA
				// change re-runs it in the same commit): starting a context for a canvas the
				// tree has already dropped would leak a device nobody disposes.
				if (cancelled) return;
				return host.init(canvas, { sampleCount });
			})
			.catch((err: unknown) => {
				if (!cancelled)
					onErrorRef.current(`field host init failed: ${errorMessage(err)}`);
			});
		return () => {
			cancelled = true;
			// Dispose only once init has SETTLED. `init` awaits the GPU context and the
			// material build, and disposing mid-await pulls the context out from under
			// those trailing creations. `started` is the post-`.catch` promise, so it
			// never rejects and `finally` always runs.
			//
			// Handing the result to `teardown` is the other half: the NEXT init starts from
			// this promise, so dispose→init stays ordered even though dispose is deferred.
			// The trailing catch keeps that chain CLEAN: a dispose that threw would
			// otherwise ride into the next init's `.catch` and be reported as a failure to
			// start the viewport, which is a wrong sentence about a real problem.
			// Unreachable today (nothing in `dispose` throws) — one line of honesty about
			// a chain that now outlives a single mount.
			teardown.current = started
				.finally(() => host.dispose())
				.catch(() => undefined);
		};
	}, [host, sampleCount]);

	// The focus seam (F4.5c Task 10), installed for as long as there is a canvas.
	//
	// A SEPARATE effect from the GPU lifecycle above, and it must stay one: that effect
	// re-runs on an AA change (it disposes and rebuilds the WebGPU context), while the
	// element it is about never changes — React creates this `<canvas>` once and keeps it.
	// Folding the two together would tear the listeners down and rebuild them for a reason
	// that has nothing to do with focus, and would drop the record mid-gesture.
	//
	// CAPTURE phase, on the WINDOW, for both events. Capture is what puts this before the
	// focus transfer the gesture is about to cause — a browser focuses a clicked control as
	// the default action of `mousedown`, which `pointerdown` precedes — and the window is
	// where it has to sit for two reasons: the gesture that opens an overlay lands on a
	// trigger somewhere else in the chrome entirely, AND the window is the only target that
	// also sees an event dispatched AT the window rather than at an element. `document`
	// looks equivalent and is not: it is skipped when nothing below it is the target, which
	// is exactly how the chord openers arrive (`useGlobalKeybindings` binds ⌘K, ⌘S and ⌫ to
	// the window). Measured — with the listener on `document` every chord-summoned surface
	// recorded a silent no and the return never fired for one.
	//
	// TWO events rather than one, and the pair is what makes the rule conditional. The
	// pointerdown answers "the user clicked chrome while flying" (yes, hand the canvas
	// back); the keydown answers "the user Tabbed here and pressed ⏎" (no — by then focus
	// is on the trigger, so the record is correctly false, and Radix's own restoration is
	// the WCAG 2.4.3 behaviour we must not override). A keydown ALSO covers the openers
	// that have no trigger at all: ⌘K, ⌘S, ⌫ over the canvas.
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const record = (): void => {
			// IDENTITY, not `contains`: a `<canvas>` has no focusable children, and `<body>`
			// — where a browser parks focus when nobody owns it — must not count, or every
			// overlay dismissed from a cold page would seize the keyboard.
			heldAtGestureStart.current = document.activeElement === canvas;
		};
		window.addEventListener("pointerdown", record, true);
		window.addEventListener("keydown", record, true);
		viewportFocusRef.current = {
			// `preventScroll`, like Radix's own focus helper: the canvas is an absolute fill
			// of its cell, and scrolling an ancestor to reveal something already on screen
			// would move the whole shell for nothing.
			focus: () => canvas.focus({ preventScroll: true }),
			heldFocusAtGestureStart: () => heldAtGestureStart.current,
		};
		return () => {
			window.removeEventListener("pointerdown", record, true);
			window.removeEventListener("keydown", record, true);
			// Cleared, not left dangling: an overlay outliving the canvas (an init failure
			// unmounts it) must find no viewport rather than focus a detached element.
			viewportFocusRef.current = null;
		};
	}, [viewportFocusRef]);

	// tabIndex makes it focusable: the host attaches its WASD/QE fly, [ / ] radius and
	// arrow-nudge keydowns to the CANVAS, so they only land while it holds focus — which
	// is why the focus ring is not optional here: it is the only signal that those keys
	// will go anywhere. `ring-inset` keeps it inside the canvas box, where an outset
	// ring on an inset-0 fill would sit under the bars.
	//
	// `focus-visible` and not `focus`, deliberately: a click takes focus SILENTLY, which is
	// the DCC norm and was ruled on at F4.5c Task 10 — the argument lives at the note in
	// `ShortcutsDialog.tsx`'s canvas group, where the question was originally left open.
	return (
		<canvas
			ref={ref}
			tabIndex={0}
			aria-label="field viewport"
			className="absolute inset-0 h-full w-full outline-none ring-inset focus-visible:ring-1 focus-visible:ring-ring"
		/>
	);
}
