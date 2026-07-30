// The Field panel (F1/F2b): the dig-loop CONTROL STACK. It drives the tool
// palette (brush effects, selection gestures, stamp generators) + the persistent
// material swatches + the brush inspector (radius/mask/smooth/hollow), the stamp
// inspector and the advisor's flags. What the viewport SHOWS
// — shading, the layer gates, the slice plane, AA — is not here: it went to the
// top bar's View popover, where it is one click from anywhere instead of hidden
// behind a palette the user may have closed. The persistence concern — which world
// this is, Save / Open / Bake — is the SHELL's now (the world chip, the drawer,
// ⌘S): a control stack that owns
// the save verb cannot be dissolved into palettes, and closing the palette
// holding it would take ⌘S with it. The material table it renders swatches from
// arrives the same way, off the catalog provider the shell mounts. What the world
// already CONTAINS — the committed entity list and the drift report — is a palette
// of its own (shell/EntitiesPalette), the first organ out of this file.
// It owns NO canvas: the shell mounts the one full-window viewport (CanvasHost)
// and inits the host on it. It owns NO host subscription either — all nine seams
// are single slots the shell holds (useFieldHostState), and subscribing to any of
// them here would silently steal the shell's callback; what this file renders from
// (the armed tool, the selection, the live session, the advisor's flags) it reads
// out of that provider's contexts. It has no status line: what the editor SAYS
// goes to the notification store (toasts + the message log), which is a shell
// surface. The host is created ONCE at engine-ready (App) and reached ONLY through
// the /engine.js runtime channel (a context ref) — the chrome never value-imports
// engine code (the project-first invariant). This file type-imports the field host
// types (all erased).
import { useEffect, useState } from "react";
import type {
	FieldGeneratorInfo,
	FieldTool,
	ViewportGesture,
} from "../../viewport-host/index.ts"; // type-only: erased
import { useCatalog } from "../hooks/useCatalogs.tsx";
import {
	useFieldFlags,
	useFieldSelection,
	useFieldStamp,
	useFieldTool,
} from "../hooks/useFieldHostState.tsx";
import { useEditor } from "./editor-context.ts";
import { BrushInspector } from "./field/BrushInspector.tsx";
import { FlagsSection } from "./field/FlagsSection.tsx";
import { MaterialSwatches } from "./field/MaterialSwatches.tsx";
import { StampInspector } from "./field/StampInspector.tsx";
import { ToolPalette } from "./field/ToolPalette.tsx";
import { Button } from "./ui/button.tsx";

export function FieldPanel() {
	const { state, fieldHostRef } = useEditor();
	// Everything host-mirrored is the SHELL's, read out of the provider's contexts (see
	// this file's header): the armed brush and its radius, the selection, the live
	// session, and the advisor's findings with the verify column that rides them.
	const { tool, radius, setTool, setRadius } = useFieldTool();
	const { selection } = useFieldSelection();
	const { stamp } = useFieldStamp();
	const { flags, filters, setFilters, verifying, verify } = useFieldFlags();
	// ONE armed-gesture slot, mirroring the host's (ViewportGesture): the three
	// selection gestures and the segment brush all bind LMB, so they cannot be
	// armed independently. `selectionArmed` is the narrower question the two
	// brush-facing gates below ask — the segment gesture keeps LMB on the brush,
	// so it must NOT hide the brush inspector or grey the ghost toggle.
	const [gesture, setGestureState] = useState<ViewportGesture | null>(null);
	const selectionArmed = gesture !== null && gesture !== "segment";
	// Full registry info — paramSchema/defaults feed the stamp inspector's form.
	const [generators, setGenerators] = useState<FieldGeneratorInfo[]>([]);
	// Range floors until the host-constants effect reads the real core ceilings.
	const [smoothLimits, setSmoothLimits] = useState({
		maxStrength: 1,
		maxIterations: 1,
	});
	// The project's material classes + the tick that says the ENTITY catalog is now on
	// the host. Both come from the shell's catalog provider: the fetch has to happen
	// whether or not this palette is open, and the world drawer needs the same result.
	const { table, entityCatalogTick } = useCatalog();

	// Host-surfaced state, read at engine-ready (it reaches the chrome through the
	// host because the chrome cannot value-import core). The smooth ceilings are
	// true constants; the generator registry is NOT — see refreshGenerators.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		setSmoothLimits(host.getSmoothLimits());
		setGenerators(host.listGenerators());
	}, [state.status, fieldHostRef]);

	// Re-read the generator registry when the entity catalog lands.
	// `listGenerators()` is a SNAPSHOT: an archetype-driven generator's
	// `archetypeId` param only carries its picker options once the host HOLDS the
	// entity catalog, and that catalog arrives off an async fetch which cannot
	// possibly settle before the effect above first runs at engine-ready. Reading
	// once left `archetypeId` a free-text field forever (review B1). The tick
	// carries nothing on purpose: the HOST is the source of truth, and a payload
	// would invite reading it instead. The zero guard is what keeps this from
	// re-reading at mount, before anything has been installed.
	useEffect(() => {
		if (entityCatalogTick === 0) return;
		const host = fieldHostRef.current;
		if (!host) return;
		setGenerators(host.listGenerators());
	}, [entityCatalogTick, fieldHostRef]);

	const onBrush = (effect: FieldTool["effect"]): void => {
		// Paint retints solids and is organic-only: paint on a kit class would
		// emit a sphere-shaped kit write, which core rejects (kit stays
		// box+lattice) — clamp to the first organic class (rock, class 0, is
		// guaranteed organic). The swatches disable kit classes while paint is
		// active for the same reason.
		let materialId = tool.materialId;
		const paintable = table.classes.some(
			(c) => c.id === materialId && c.kind === "organic",
		);
		if (effect === "paint" && !paintable)
			materialId = table.classes.find((c) => c.kind === "organic")?.id ?? 0;
		setTool({ ...tool, effect, materialId });
		// A brush pick disarms a SELECTION gesture — LMB returns to the brush. It
		// deliberately leaves `segment` armed: picking Fill under the segment brush
		// means "sweep a rampart instead of a tunnel", not "stop segmenting".
		if (selectionArmed) {
			setGestureState(null);
			fieldHostRef.current?.setGesture(null);
		}
	};

	const onGesturePick = (next: ViewportGesture): void => {
		setGestureState(next);
		fieldHostRef.current?.setGesture(next);
	};

	const onMaterial = (id: number): void => setTool({ ...tool, materialId: id });

	if (state.status !== "ready") {
		return (
			<p className="p-3 text-sm text-muted-foreground">
				the field waits for the engine bundle…
			</p>
		);
	}

	// The live session's registry info (its paramSchema feeds the form). The
	// find can only miss if the registry changed under a live session —
	// impossible today (FIELD_GENERATORS is static); the guard simply hides
	// the inspector rather than crash on a schema-less form.
	const stampDef =
		stamp === null
			? undefined
			: generators.find((g) => g.id === stamp.generator);

	return (
		<div className="flex h-full flex-col">
			{/* The controls stack (palette + swatches + inspectors + flags) takes whatever
          height the selection footer below leaves, and scrolls INSIDE
          itself. The F2b-era 45% cap is gone with the canvas it was protecting: the
          panel is nothing but controls now, so a tall StampInspector form has nothing
          left to starve. min-h-0 is what lets a flex child shrink below its content
          instead of pushing the footer off the bottom. */}
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex flex-col gap-2 border-b border-border p-2 text-sm">
					<ToolPalette
						effect={tool.effect}
						gesture={gesture}
						generators={generators}
						onBrush={onBrush}
						onGesture={onGesturePick}
						onGenerator={(id) => fieldHostRef.current?.startStamp(id)}
					/>
					{/* The persistent swatch strip: rendered whenever the catalog has more
              than one class, independent of the active tool (the eyedropper can
              change the material under ANY tool — the ring must track it). */}
					{table.classes.length > 1 && (
						<MaterialSwatches
							classes={table.classes}
							activeId={tool.materialId}
							disableKit={tool.effect === "paint"}
							onSelect={onMaterial}
						/>
					)}
					{/* Brush inspector only while LMB actually brushes — an armed selection
              gesture makes radius/mask/smooth/hollow promises LMB won't keep. */}
					{!selectionArmed && (
						<BrushInspector
							tool={tool}
							radius={radius}
							smoothLimits={smoothLimits}
							classes={table.classes}
							onRadius={setRadius}
							onChange={setTool}
						/>
					)}
					{/* The stamp inspector rides the session's existence, independent of
              the brush/selection state — the brush stays live during a session
              (its strokes are the documented divergence window). */}
					{stamp !== null && stampDef !== undefined && (
						<StampInspector
							session={stamp}
							def={stampDef}
							onUpdate={(params, seed, policy) =>
								fieldHostRef.current?.updateStamp(params, seed, policy)
							}
							onNudge={(dx, dy, dz) =>
								fieldHostRef.current?.nudgeStamp(dx, dy, dz)
							}
							onReroll={() => fieldHostRef.current?.rerollStamp()}
							// ONE verb: the host maps mode→commit/apply for Enter already,
							// and the panel calling the same seam is what keeps that mapping
							// from existing in two places that can disagree.
							onCommit={() => fieldHostRef.current?.commitSession()}
							onCancel={() => fieldHostRef.current?.cancelStamp()}
						/>
					)}
				</div>
				{/* The advisor's findings. The layer gate that draws their markers is the
            View popover's now, so this section stands on its own: it owns its border
            (the DriftReport rule) and renders nothing until something is found, so a
            world with no complaints costs no space. */}
				<FlagsSection
					summary={flags}
					filters={filters}
					onFilters={setFilters}
					onFrame={(chunks) => fieldHostRef.current?.frameChunks(chunks)}
					verifying={verifying}
					onVerify={verify}
				/>
			</div>
			{/* The panel's own footer: the selection verbs, and nothing else. The op-cost
          meter went to the shell's status bar (the only subscriber to that seam) and
          the status line went with the message channel it was — refusals and reports
          are toasts now, over the canvas, with the log behind them. */}
			<div className="flex items-center gap-1.5 border-t border-border px-2 py-1 text-xs text-muted-foreground">
				{selection && (
					<span className="tabular-nums">
						{selection.count} selected
						{selection.truncated && ` — flood truncated at ${selection.count}`}
					</span>
				)}
				{selection && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-5 px-1.5 text-xs"
						onClick={() => fieldHostRef.current?.clearSelection()}
					>
						Clear
					</Button>
				)}
				{/* Always shown: Reselect restores what the last Clear/replace
              displaced, so it matters exactly when there is NO selection; the
              host no-ops on an empty slot. */}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-5 px-1.5 text-xs"
					title="restore the previous selection"
					onClick={() => fieldHostRef.current?.reselect()}
				>
					Reselect
				</Button>
			</div>
		</div>
	);
}
