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
// supply. The palette arrangement lives here for the same reason: its restore, its
// debounced write and its ⌘\ latch are all behaviour, and behaviour above the Shell
// boundary is behaviour no test can reach.
import { useCallback, useState } from "react";
import type { FieldHost } from "../../../viewport-host/index.ts"; // type-only: erased
import { CatalogProvider } from "../../hooks/useCatalogs.tsx";
import { FieldHostStateProvider } from "../../hooks/useFieldHostState.tsx";
import { useGlobalKeybindings } from "../../hooks/useGlobalKeybindings.ts";
import {
	useWorkspaceActions,
	WorkspaceProvider,
} from "../../hooks/useWorkspace.tsx";
import { useWorldActions, WorldProvider } from "../../hooks/useWorld.tsx";
import { useEditor } from "../editor-context.ts";
import { FieldPanel } from "../FieldPanel.tsx";
import { CanvasHost } from "./CanvasHost.tsx";
import { LogPalette } from "./LogPalette.tsx";
import { PaletteLayer } from "./PaletteLayer.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { Toasts } from "./Toasts.tsx";
import { TopBar } from "./TopBar.tsx";

/** The workspace provider wraps the WHOLE frame, not just the layer: the top bar's
 *  hide/show toggle and the burger's Reset act on the same arrangement the layer
 *  renders. The frame is a child component rather than this function's own body because
 *  the global keybinding listener has to be able to READ the provider it sits under. */
export function Shell() {
	const { store } = useEditor();
	return (
		<WorkspaceProvider store={store}>
			<ShellFrame />
		</WorkspaceProvider>
	);
}

/** The provider stack, in dependency order: the host-state mirror first (a single
 *  subscription slot, claimed once), then the world state that derives its dirty bit
 *  from that mirror's stats, then the project catalogs. The chrome itself is one level
 *  further down — `useGlobalKeybindings` binds ⌘S to a world verb, and a hook cannot
 *  read a provider its own JSX renders. */
function ShellFrame() {
	const { state, fieldHostRef } = useEditor();
	// Reading the ref during render is safe HERE and only here: App assigns it exactly
	// once, synchronously before the `engine-ready` dispatch that causes this render,
	// and never reassigns it. The gate below is what makes that ordering visible.
	const host = fieldHostRef.current;
	const engineReady = state.status === "ready";

	return (
		<FieldHostStateProvider host={host} engineReady={engineReady}>
			<WorldProvider>
				<CatalogProvider>
					<ShellChrome host={host} engineReady={engineReady} />
				</CatalogProvider>
			</WorldProvider>
		</FieldHostStateProvider>
	);
}

function ShellChrome({
	host,
	engineReady,
}: {
	host: FieldHost | undefined;
	engineReady: boolean;
}) {
	const { fieldHostRef, confirmRef } = useEditor();
	// A field-host init failure is LOCAL (the chrome still works), so it reports on the
	// status bar rather than blanking the editor with a global engine-error.
	const [viewportError, setViewportError] = useState<string | null>(null);
	const { toggleHidden } = useWorkspaceActions();
	// ACTIONS only, from both providers. This component builds the palette bodies below,
	// so reading either STATE context would rebuild those elements — and re-render the
	// panel behind them — on every drag frame and every world edit.
	const { save } = useWorldActions();

	// Straight to the host: the field's op log IS the editor's history (ONE history —
	// there is no second document to step). The canvas binds the same chord itself and
	// stops it propagating, so a ⌘Z with the viewport focused steps once, not twice.
	// Stable, so the window listener re-binds only when the world verbs change.
	const undo = useCallback(() => fieldHostRef.current?.undo(), [fieldHostRef]);
	const redo = useCallback(() => fieldHostRef.current?.redo(), [fieldHostRef]);

	// The ONE window keydown listener. It lives inside the workspace provider because ⌘\
	// acts on the arrangement; App keeps the confirm dialog whose open state suppresses
	// every binding, and hands its ref down through the editor context.
	useGlobalKeybindings({
		confirmRef,
		onTogglePalettes: toggleHidden,
		onSave: save,
		onUndo: undo,
		onRedo: redo,
	});

	return (
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
				{/* The palette bodies are built HERE so their elements survive the
            layer's own drag re-renders untouched (see PaletteLayer's `content`).
            MIGRATION (until F4.5b): the surviving control stack rides in one
            `controls` palette until its organs move into palettes of their own. */}
				<PaletteLayer
					content={{ controls: <FieldPanel />, log: <LogPalette /> }}
				/>
				{/* Above the palette layer in DOM order, so a toast is never buried under
            a palette that happens to be parked bottom-right. Its own absolute box
            inside the SAME cell (D-1): it takes nothing from the canvas. */}
				<Toasts />
			</div>
			<StatusBar viewportError={viewportError} />
		</div>
	);
}
