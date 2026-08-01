// THE LAYOUT CONTRACT (F4.5 D-1, and the one rule the whole overlay cockpit rests on):
// the canvas cell's insets are decided by the two fixed-height bars and the tool rail, and
// NOTHING else. No palette opening, no selection changing, no panel resizing may move them
// — a viewport that re-lays-out under the user is what the dock era got wrong. Every
// floating surface therefore mounts as an ABSOLUTE layer inside the cell, over the
// canvas, never as a flex sibling of it.
//
// The RAIL is the one exception, and it is an exception the same way the bars are: a fixed
// 44 px column that cannot be closed, moved, collapsed or resized, so it is part of the
// constant inset rather than something that can change one. It sits in a flex ROW with the
// cell — a sibling, never a parent — which is what keeps the canvas's `absolute inset-0`
// resolving against a box only the window can resize.
//
// Split out of App on purpose: App owns the engine bootstrap (a dynamic import of the
// project-built /engine.js plus a WebGPU probe), neither of which can reach "ready"
// outside a browser — so with the layout inside App the contract above would be
// untestable. Shell reads everything it needs from EditorContext, which a test can
// supply. The palette arrangement lives here for the same reason: its restore, its
// debounced write and its ⌘\ latch are all behaviour, and behaviour above the Shell
// boundary is behaviour no test can reach.
import { useState } from "react";
import type { FieldHost } from "../../../viewport-host/index.ts"; // type-only: erased
import { ActionContextProvider } from "../../hooks/useActionContext.tsx";
import { CatalogProvider } from "../../hooks/useCatalogs.tsx";
import { FieldHostStateProvider } from "../../hooks/useFieldHostState.tsx";
import { PaletteStackProvider } from "../../hooks/usePaletteStack.tsx";
import { useViewState, ViewProvider } from "../../hooks/useView.tsx";
import { WorkspaceProvider } from "../../hooks/useWorkspace.tsx";
import { WorldProvider } from "../../hooks/useWorld.tsx";
import { useEditor } from "../editor-context.ts";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { AxisTriadMount } from "./AxisTriadMount.tsx";
import { CanvasHost } from "./CanvasHost.tsx";
import { EntitiesPalette } from "./EntitiesPalette.tsx";
import { FlagsPalette } from "./FlagsPalette.tsx";
import { HistoryPalette } from "./HistoryPalette.tsx";
import { LogPalette } from "./LogPalette.tsx";
import { PaletteLayer } from "./PaletteLayer.tsx";
import { SessionCard, SessionCardPresence } from "./SessionCard.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { Toasts } from "./Toasts.tsx";
import { ToolRail } from "./ToolRail.tsx";
import { TopBar } from "./TopBar.tsx";

/** The workspace provider wraps the WHOLE frame, not just the layer: the top bar's
 *  hide/show toggle and the burger's Reset act on the same arrangement the layer
 *  renders. The frame is a child component rather than this function's own body because
 *  the action context — which carries ⌘\ and Reset workspace — has to be able to READ the
 *  provider it sits under. */
export function Shell() {
	const { store } = useEditor();
	return (
		<WorkspaceProvider store={store}>
			{/* Front-to-back order, session-local and NOT part of the arrangement (see its
          header). It wraps the whole frame rather than living in the palette layer
          because the two surfaces that OPEN a palette — the status bar's ⚠ chip and the
          burger's View group — are the layer's siblings, not its children. */}
			<PaletteStackProvider>
				<ShellFrame />
			</PaletteStackProvider>
		</WorkspaceProvider>
	);
}

/** The provider stack, in dependency order: the host-state mirror first (a single
 *  subscription slot, claimed once), then the view state that pushes into the same host,
 *  then the project catalogs, then the world state — which reads BOTH of the two above
 *  it, the mirror's stats for its dirty bit and the catalogs' materials settle for its
 *  boot restore (a world must not remesh against the wrong table). The chrome itself is
 *  one level further down — the action context reads all four, and a hook cannot read a
 *  provider its own JSX renders. */
function ShellFrame() {
	const { state, fieldHostRef, store } = useEditor();
	// Reading the ref during render is safe HERE, and this is the ONE place that does it:
	// App assigns it exactly once, synchronously before the `engine-ready` dispatch that
	// causes this render, and never reassigns it. The gate below is what makes that
	// ordering visible. Everything downstream takes the host as a PROP from here.
	const host = fieldHostRef.current;
	const engineReady = state.status === "ready";

	return (
		<FieldHostStateProvider host={host} engineReady={engineReady} store={store}>
			<ViewProvider host={host} engineReady={engineReady} store={store}>
				<CatalogProvider>
					<WorldProvider>
						<ShellChrome host={host} engineReady={engineReady} />
					</WorldProvider>
				</CatalogProvider>
			</ViewProvider>
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
	// A field-host init failure is LOCAL (the chrome still works), so it reports on the
	// status bar rather than blanking the editor with a global engine-error.
	const [viewportError, setViewportError] = useState<string | null>(null);

	// This component reads NO state context — not the world's, not the view's, not the
	// arrangement's — and that is deliberate: it builds the palette bodies below, so any
	// state it read would rebuild those elements (and re-render the panel behind them) on
	// every drag frame and every world edit. The action context provider does all of that
	// reading one level down, where its `children` arrive already built.
	return (
		<ActionContextProvider host={host ?? null}>
			{/* ONE tooltip provider for the whole frame (D-25): the rail, the strip and the
          ⋯ all use real Radix tooltips rather than `title`, and Radix wants a single
          provider so the group's open/close delays behave as one — hovering the second
          rail button after the first opens instantly instead of waiting again. */}
			<TooltipProvider delayDuration={300}>
				<div className="fixed inset-0 flex flex-col bg-background text-foreground">
					<TopBar />
					{/* The body ROW: the fixed rail column, then the canvas cell. Both are
              siblings — the rail is part of the cell's constant inset (see this file's
              header), never a parent of it and never a palette. */}
					<div className="flex min-h-0 flex-1">
						<ToolRail />
						{/* bg-viewport-background is the DESIGN.md §2 viewport surface: one tonal
          step darker than the app base, so the content area reads as distinct from
          the chrome before the first GPU frame clears and anywhere the canvas is
          absent (engine still booting, init failed). */}
						<div className="relative min-h-0 min-w-0 flex-1 bg-viewport-background">
							{engineReady && host && (
								<FieldCanvas host={host} onError={setViewportError} />
							)}
							{/* The palette bodies are built HERE so their elements survive the
                  layer's own drag re-renders untouched (see PaletteLayer's `content`).
                  Every one of them is a single CONCERN: F4.5b finished dissolving the
                  `controls` stack, so there is no longer a palette that is merely "the
                  panel" and no id here without a subject. */}
							<PaletteLayer
								content={{
									entities: <EntitiesPalette />,
									session: <SessionCard />,
									flags: <FlagsPalette />,
									history: <HistoryPalette />,
									log: <LogPalette />,
								}}
							/>
							{/* The session card's open state is DRIVEN (D-13), and the thing that
                  opens a palette cannot live inside it — the layer unmounts a closed
                  palette's body. So the driver is a sibling that renders nothing and
                  reads only the two host facts it decides from. Mounted HERE rather than
                  inside ShellChrome's own body for the reason that whole component reads
                  no state context: a subscription up there would rebuild the palette
                  elements above on every session push. */}
							<SessionCardPresence />
							{/* Above the palette layer in DOM order, the Toasts rule and for the
                  same reason: the triad's corner is not reserved, only left clear by
                  the shipped defaults, so ANY palette the user docks right or drags
                  into the top-right covers it — and mounted under the layer it would
                  disappear the first time they did. (It used to ship invisible out of
                  the box, because the `controls` palette docked right at top 0 by
                  default; that id retired in F4.5b and nothing docks by default now,
                  which makes this a rule about what the user can do rather than about
                  the defaults.) Gated on the host like the canvas, because a pose
                  readout with no camera behind it is a decoration. Its own absolute
                  box inside the SAME cell (D-1): it takes nothing from the canvas. */}
							{engineReady && host && <AxisTriadMount />}
							{/* Above the palette layer in DOM order, so a toast is never buried
                  under a palette that happens to be parked bottom-right. Its own absolute
                  box inside the SAME cell (D-1): it takes nothing from the canvas. */}
							<Toasts />
						</div>
					</div>
					<StatusBar viewportError={viewportError} />
				</div>
			</TooltipProvider>
		</ActionContextProvider>
	);
}

/** The canvas plus the one piece of view state it needs. A separate component so
 *  ShellChrome does NOT read the view context: ShellChrome builds the palette bodies, so
 *  every render of it rebuilds those elements and re-renders all five palettes with them
 *  — the same reason it now reads no state context at all. Here the re-render stops at a
 *  canvas element React never re-creates. */
function FieldCanvas({
	host,
	onError,
}: {
	host: FieldHost;
	onError: (message: string) => void;
}) {
	const { sampleCount } = useViewState();
	return <CanvasHost host={host} sampleCount={sampleCount} onError={onError} />;
}
