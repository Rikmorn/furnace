// The full-window canvas layer: the one surface the FieldHost renders into, sized by
// the shell's layout contract rather than by any panel.
import { useEffect, useRef } from "react";
import type { FieldHost } from "../../../viewport-host/index.ts"; // type-only: erased
import { errorMessage } from "../../lib/humanize.ts";

/**
 * Mounts the canvas and inits `host` on it. Init is EAGER — the dock-era
 * `initWhenSized` deferral is retired (D-1): this canvas is an absolute fill of a
 * layout cell whose height comes from two fixed-height bars, so it is sized by
 * construction at the first effect. A zero measure therefore isn't "not laid out yet",
 * it is the shell's CSS contract broken, and waiting for a resize that will never come
 * would hide it. Fail loud instead.
 *
 * `onError` carries an init REJECTION (a GPU/context failure) to the status bar —
 * local, not a global engine-error: the chrome is still usable and the message is the
 * only diagnosis a user gets.
 */
export function CanvasHost({
	host,
	onError,
}: {
	host: FieldHost;
	onError: (message: string) => void;
}) {
	const ref = useRef<HTMLCanvasElement>(null);

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
		const started = host.init(canvas).catch((err: unknown) => {
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
			// Honest limit: this does NOT by itself make a double-invoked mount safe. The
			// host serializes nothing, so a re-init landing before this deferred dispose
			// still hits its own "already initialized" guard. Nothing double-invokes
			// today — main.tsx mounts no StrictMode.
			void started.finally(() => host.dispose());
		};
	}, [host]);

	// tabIndex makes it focusable: the host attaches its WASD/QE fly, [ / ] radius and
	// arrow-nudge keydowns to the CANVAS, so they only land while it holds focus — which
	// is why the focus ring is not optional here: it is the only signal that those keys
	// will go anywhere. `ring-inset` keeps it inside the canvas box, where an outset
	// ring on an inset-0 fill would sit under the bars.
	return (
		<canvas
			ref={ref}
			tabIndex={0}
			aria-label="field viewport"
			className="absolute inset-0 h-full w-full outline-none ring-inset focus-visible:ring-1 focus-visible:ring-ring"
		/>
	);
}
