// THE LAYOUT CONTRACT (F4.5 D-1, and the one rule the whole overlay cockpit rests on):
// the canvas cell's insets are decided by the two fixed-height bars and NOTHING else.
// No palette opening, no selection changing, no panel resizing may move them — a
// viewport that re-lays-out under the user is what the dock era got wrong. Every
// floating surface therefore mounts as an ABSOLUTE layer inside the cell, over the
// canvas, never as a flex sibling of it.
//
// Split out of App on purpose: App owns the engine bootstrap (a dynamic import of the
// project-built /engine.js plus a WebGPU probe), neither of which can reach "ready"
// outside a browser — so with the layout inside App the contract above would be
// untestable. Shell reads everything it needs from EditorContext, which a test can
// supply.
import { useState } from "react";
import { FieldHostStateProvider } from "../../hooks/useFieldHostState.tsx";
import { useEditor } from "../editor-context.ts";
import { FieldPanel } from "../FieldPanel.tsx";
import { CanvasHost } from "./CanvasHost.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { TopBar } from "./TopBar.tsx";

export function Shell() {
	const { state, fieldHostRef } = useEditor();
	// Reading the ref during render is safe HERE and only here: App assigns it exactly
	// once, synchronously before the `engine-ready` dispatch that causes this render,
	// and never reassigns it. The gate below is what makes that ordering visible.
	const host = fieldHostRef.current;
	const engineReady = state.status === "ready";
	// A field-host init failure is LOCAL (the chrome still works), so it reports on the
	// status bar rather than blanking the editor with a global engine-error.
	const [viewportError, setViewportError] = useState<string | null>(null);

	return (
		<FieldHostStateProvider host={host} engineReady={engineReady}>
			<div className="fixed inset-0 flex flex-col bg-background text-foreground">
				<TopBar />
				{/* bg-viewport-background is the DESIGN.md §2 viewport surface: one tonal
            step darker than the app base, so the content area reads as distinct from
            the chrome before the first GPU frame clears and anywhere the canvas is
            absent (engine still booting, init failed). */}
				<div className="relative min-h-0 flex-1 bg-viewport-background">
					{engineReady && host && (
						<CanvasHost host={host} onError={setViewportError} />
					)}
					{/* The floating-palette layer mounts here — absolute, over the canvas. */}
					{/* MIGRATION (until F4.5b): the surviving control stack, parked as a
              right-docked panel until its organs move into palettes. ABSOLUTE, not a
              flex sibling: as a sibling it would eat width from the canvas cell and
              break the contract at the top of this file. */}
					<aside
						aria-label="field controls"
						className="absolute inset-y-0 right-0 w-[300px] border-l border-border bg-card"
					>
						<FieldPanel />
					</aside>
				</div>
				<StatusBar viewportError={viewportError} />
			</div>
		</FieldHostStateProvider>
	);
}
