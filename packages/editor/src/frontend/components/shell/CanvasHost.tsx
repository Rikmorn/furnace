// The full-window canvas layer: the one surface the FieldHost renders into, sized by
// the shell's layout contract rather than by any panel.
import { useEffect, useRef } from "react";
import type { FieldHost } from "../../../viewport-host/index.ts"; // type-only: erased
import { errorMessage } from "../field/form-bits.tsx";

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
	/** Must be referentially stable — it is an effect dependency. */
	onError: (message: string) => void;
}) {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0)
			throw new Error(
				"CanvasHost: the canvas measured zero at mount — the shell's layout contract is broken",
			);
		let cancelled = false;
		host.init(canvas).catch((err: unknown) => {
			if (!cancelled) onError(`field host init failed: ${errorMessage(err)}`);
		});
		return () => {
			cancelled = true;
			host.dispose();
		};
	}, [host, onError]);

	// tabIndex makes it focusable: the host attaches its WASD/QE fly, [ / ] radius and
	// arrow-nudge keydowns to the CANVAS, so they only land while it holds focus.
	return (
		<canvas
			ref={ref}
			tabIndex={0}
			aria-label="field viewport"
			className="absolute inset-0 h-full w-full outline-none"
		/>
	);
}
