// The Field panel (F1/F2b): the dig-loop chrome. It mounts a <canvas> the
// App-owned FieldHost renders into (LMB applies the tool or a selection
// gesture, RMB looks, WASD/QE flies, wheel/[ ] size the brush, ⌘Z undoes, and
// the arrows nudge a pending stamp's region) and exposes the tool palette
// (brush effects, selection gestures, stamp generators) + the persistent
// material swatches + the brush inspector (radius/mask/smooth/hollow) +
// shading. The persistence concern — world name, Save / Load / Bake-as-default,
// and the run-once catalog fetch that gates Load — lives in FieldToolbar
// (extracted, F2b sweep); the panel keeps the table (swatches) and the status
// line the toolbar reports into.
// The host is created ONCE at engine-ready (App) and reached ONLY through the
// /engine.js runtime channel (a context ref) — the chrome never value-imports
// engine code (the project-first invariant). This file type-imports the field
// host + artifact types (all erased).
import type { GeneratorEntity, MaterialTable } from "@furnace/core/field"; // type-only: erased
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	FieldGeneratorInfo,
	FieldHostShading,
	FieldLayers,
	FieldMaskChoice,
	FieldStats,
	FieldTool,
	SelectionInfo,
	SelectionMode,
	StampSession,
} from "../../viewport-host/index.ts"; // type-only: erased
import { initWhenSized } from "../lib/init-when-sized.ts";
import { useEditor } from "./editor-context.ts";
import { BrushInspector } from "./field/BrushInspector.tsx";
import { EntitiesList } from "./field/EntitiesList.tsx";
import { FieldToolbar } from "./field/FieldToolbar.tsx";
import { LayersRow } from "./field/LayersRow.tsx";
import { MaterialSwatches } from "./field/MaterialSwatches.tsx";
import { StampInspector } from "./field/StampInspector.tsx";
import { ToolPalette } from "./field/ToolPalette.tsx";
import { Button } from "./ui/button.tsx";
import { errorMessage } from "./world-panel/fields.tsx";

// Mirror FieldHost's default digRadius (the range lives in BrushInspector).
const DEFAULT_RADIUS = 1.25;

// The panel's initial brush — mirrors the host's own defaultTool() (dig into
// rock, unmasked, core SMOOTH_DEFAULTS-equivalent smooth, solid fill). A
// local literal: the chrome cannot value-import core or the host
// (frontend-no-engine-leakage), and subscribeTool fires only on
// HOST-initiated changes, so there is nothing to seed from at mount.
const DEFAULT_TOOL: FieldTool = {
	effect: "dig",
	materialId: 0,
	mask: { kind: "none" },
	smooth: { strength: 16, iterations: 1, mode: "both" },
	hollow: null,
};

// Dropdown/swatch fallback before the catalog resolves and when there is none
// (404): rock only. A LOCAL literal — the chrome can't value-import core's
// BUILTIN_TABLE (frontend-no-engine-leakage). The host keeps its own
// BUILTIN_TABLE default; this only feeds the panel's material UI.
const ROCK_ONLY_TABLE: MaterialTable = {
	classes: [
		{ id: 0, name: "rock", kind: "organic", color: [0.62, 0.6, 0.58, 1] },
	],
};

// Panel-side layer defaults — mirror the host's own all-true default (a local
// literal for the same reason as DEFAULT_TOOL: the chrome cannot value-import
// the host). Pushed to the host at engine-ready so both start in agreement.
const DEFAULT_LAYERS: FieldLayers = {
	field: true,
	kit: true,
	ghost: true,
	selection: true,
	grid: true,
};

// Slice defaults: OFF, plane parked at 8 m — mid-range of the slider (LayersRow
// owns the −8…+24 range), high enough to cut a typical kit hall when enabled.
const SLICE_DEFAULT_Y = 8;

// Value-equality for the subscribeTool echo guard (see the mirror effect).
const masksEqual = (a: FieldMaskChoice, b: FieldMaskChoice): boolean =>
	a.kind === "class" && b.kind === "class"
		? a.classId === b.classId
		: a.kind === b.kind;

const toolsEqual = (a: FieldTool, b: FieldTool): boolean => {
	// Compiler backstop (F2b rider): destructure EVERY FieldTool field — a
	// future field lands in `rest` and fails the never-check, forcing this
	// comparator to learn it. A missed field would silently WEAKEN the
	// subscribeTool echo guard: differing tools would compare equal and the
	// mirror would drop host-initiated changes.
	const { effect, materialId, hollow, mask, smooth, ...rest } = a;
	void (rest satisfies Record<string, never>);
	// The same backstop one level down: `smooth` is a nested shape whose future
	// fields would slip past the top-level destructure unseen.
	const { strength, iterations, mode, ...smoothRest } = smooth;
	void (smoothRest satisfies Record<string, never>);
	return (
		effect === b.effect &&
		materialId === b.materialId &&
		hollow === b.hollow &&
		masksEqual(mask, b.mask) &&
		strength === b.smooth.strength &&
		iterations === b.smooth.iterations &&
		mode === b.smooth.mode
	);
};

// Entity-list identity for the refresh guard: everything a ROW can display —
// id + generator + seed + opSpan + the two state flags. Params are NOT compared
// and do not need to be: a reconfigure re-evaluates the span with fresh op ids
// (core takes them from log.nextId, which only ever grows), so any param change
// that reaches the log moves opSpan with it. The flags DO need their own
// comparison — freeze and bake rewrite the record and nothing else, so without
// them a frozen badge would never appear.
const sameEntities = (a: GeneratorEntity[], b: GeneratorEntity[]): boolean =>
	a.length === b.length &&
	a.every((e, i) => {
		const o = b[i];
		return (
			o !== undefined &&
			e.entityId === o.entityId &&
			e.generator === o.generator &&
			e.seed === o.seed &&
			e.opSpan[0] === o.opSpan[0] &&
			e.opSpan[1] === o.opSpan[1] &&
			e.frozen === o.frozen &&
			e.baked === o.baked
		);
	});

export function FieldPanel() {
	const { state, fieldHostRef, openConfirm } = useEditor();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const initialized = useRef(false);
	const [radius, setRadius] = useState(DEFAULT_RADIUS);
	const [headlamp, setHeadlamp] = useState(false);
	const [tool, setToolState] = useState<FieldTool>(DEFAULT_TOOL);
	const [selectionMode, setSelectionModeState] = useState<SelectionMode | null>(
		null,
	);
	const [selection, setSelection] = useState<SelectionInfo | null>(null);
	// Full registry info — paramSchema/defaults feed the stamp inspector's form.
	const [generators, setGenerators] = useState<FieldGeneratorInfo[]>([]);
	const [stamp, setStamp] = useState<StampSession | null>(null);
	const [entities, setEntities] = useState<GeneratorEntity[]>([]);
	const [layers, setLayers] = useState<FieldLayers>(DEFAULT_LAYERS);
	const [slice, setSlice] = useState({ enabled: false, y: SLICE_DEFAULT_Y });
	// Range floors until the host-constants effect reads the real core ceilings.
	const [smoothLimits, setSmoothLimits] = useState({
		maxStrength: 1,
		maxIterations: 1,
	});
	const [table, setTable] = useState<MaterialTable>(ROCK_ONLY_TABLE);
	const [stats, setStats] = useState<FieldStats>({
		chunks: 0,
		lastRemeshMs: 0,
		remeshVersion: 0,
	});
	const [status, setStatus] = useState("dig into the rock, then Save");

	// Run-once init (the Viewport idiom): grab the canvas once the engine is ready and the
	// App-owned host exists. Deferred to the first nonzero canvas measure (initWhenSized)
	// so mounting hidden behind another tab can't latch a zero-size init failure. NO
	// dispose in cleanup — the host outlives this panel (App owns it), exactly like the
	// viewport host. Init failure is reported LOCALLY (not a global engine-error dispatch)
	// so a Field-panel failure can't blank the whole editor: this is optional chrome.
	// Panel-reopen re-init throws "already initialized" (host bound to the prior
	// canvas) — a standing v0 limitation surfaced here.
	useEffect(() => {
		const canvas = canvasRef.current;
		const host = fieldHostRef.current;
		if (!canvas || !host || initialized.current || state.status !== "ready")
			return;
		initialized.current = true;
		return initWhenSized(canvas, () => {
			host.init(canvas).catch((err) => {
				setStatus(`field host init failed: ${errorMessage(err)}`);
			});
		});
	}, [state.status, fieldHostRef]);

	// Host-surfaced constants, read once at engine-ready: the smooth ceilings
	// and the generator registry (both reach the chrome through the host
	// because it cannot value-import core).
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		setSmoothLimits(host.getSmoothLimits());
		setGenerators(host.listGenerators());
	}, [state.status, fieldHostRef]);

	// Mirror HOST-initiated tool changes (Alt-click eyedropper, momentary
	// Shift/Ctrl overrides) into panel state. ECHO GUARD (binding rider): a
	// panel setTool that lands while a momentary modifier is held makes the
	// host re-derive and fire THIS callback with the DERIVED tool — so the
	// mirror ADOPTS only (a state write, never a host.setTool re-push: pushing
	// the derived tool back would re-derive → re-fire → loop), and
	// value-compares first so an echo of the panel's own state returns the same
	// reference (no render churn).
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		return host.subscribeTool((t) =>
			setToolState((prev) => (toolsEqual(prev, t) ? prev : t)),
		);
	}, [state.status, fieldHostRef]);

	// Selection mirror (count / truncated / Clear-Reselect in the footer). The
	// host pushes the CURRENT state on subscribe, covering a panel remount
	// while a selection exists.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		return host.subscribeSelection(setSelection);
	}, [state.status, fieldHostRef]);

	// Stamp-session mirror. subscribeStamp pushes CLONES plus the current state
	// on subscribe, so a panel remount mid-session recovers the live form.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		return host.subscribeStamp(setStamp);
	}, [state.status, fieldHostRef]);

	// Push the panel's layer/slice view defaults to the host at engine-ready,
	// and drop any entity-highlight box when the panel unmounts. The host
	// outlives the panel (App owns it) and has no layers/slice/highlight
	// subscription seam, so a REMOUNT resets all three to the panel defaults —
	// honest (the controls always show what the host uses) at the cost of
	// forgetting the toggles across tab switches; the same v0 trade as the
	// one-way radius seam below. The highlight clear keeps a remounted list
	// (expansion state reset) from standing next to a box no row claims.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		host.setLayers(DEFAULT_LAYERS);
		host.setSlice(null);
		return () => host.highlightEntity(null);
	}, [state.status, fieldHostRef]);

	// Entities refresh strategy (F3a): ONE host-pushed trigger. The host fires
	// subscribeEntities from every path that can add, remove or rewrite an
	// entity record — commit, reconfigure apply, freeze/unfreeze, bake, ⌘Z/⇧⌘Z,
	// world new/load — plus once on subscribe. It REPLACES the F2b trigger pair
	// (the stamp-session null push + the remesh counter): both were proxies for
	// "the log changed", and neither could see freeze or bake, which dirty no
	// chunk and end no session. The signature guard (sameEntities) keeps a tick
	// that changed nothing from re-rendering the panel.
	const refreshEntities = useCallback((): void => {
		const host = fieldHostRef.current;
		if (!host) return;
		setEntities((prev) => {
			const next = host.listEntities();
			return sameEntities(prev, next) ? prev : next;
		});
	}, [fieldHostRef]);

	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		return host.subscribeEntities(refreshEntities);
	}, [state.status, fieldHostRef, refreshEntities]);

	// User-facing tool problems (selection-mask misuse, swallowed stroke
	// failures, "select a region first") surface on the status line.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		return host.subscribeToolError(setStatus);
	}, [state.status, fieldHostRef]);

	// Live chunk / remesh-time readout. The host fires this every rAF; the functional guard
	// returns the SAME reference when nothing changed, so an idle field (no dig in flight)
	// does not re-render the panel 60×/second.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		return host.subscribeStats((s) =>
			setStats((prev) =>
				prev.chunks === s.chunks &&
				prev.lastRemeshMs === s.lastRemeshMs &&
				prev.remeshVersion === s.remeshVersion
					? prev
					: s,
			),
		);
	}, [state.status, fieldHostRef]);

	// Panel radius → host, DELIBERATELY one-way: the host's wheel and [ / ]
	// keys also step its radius and there is NO host→panel radius seam
	// (FieldTool does not carry radius; no subscription does), so the readout
	// can lag the host after wheel/key sizing. Pre-existing wheel asymmetry,
	// kept — the ghost ring in the viewport is the live radius display.
	const onRadius = (r: number): void => {
		setRadius(r);
		fieldHostRef.current?.setDigRadius(r);
	};

	const onShading = (on: boolean): void => {
		setHeadlamp(on);
		const mode: FieldHostShading = on ? "headlamp" : "flat";
		fieldHostRef.current?.setShading(mode);
	};

	const onLayers = (next: FieldLayers): void => {
		setLayers(next);
		fieldHostRef.current?.setLayers(next);
	};

	const onSlice = (next: { enabled: boolean; y: number }): void => {
		setSlice(next);
		fieldHostRef.current?.setSlice(next.enabled ? next.y : null);
	};

	// The one funnel for every tool change: adopt locally + push to the host.
	// The host clamps (smooth ceilings, hollow floor) as a backstop; the
	// controls stay inside the same ranges so panel and host state agree.
	const pushTool = (next: FieldTool): void => {
		setToolState(next);
		fieldHostRef.current?.setTool(next);
	};

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
		pushTool({ ...tool, effect, materialId });
		// A brush pick disarms any selection gesture — LMB returns to the brush.
		setSelectionModeState(null);
		fieldHostRef.current?.setSelectionMode(null);
	};

	const onSelectionModePick = (mode: SelectionMode): void => {
		setSelectionModeState(mode);
		fieldHostRef.current?.setSelectionMode(mode);
	};

	const onMaterial = (id: number): void =>
		pushTool({ ...tool, materialId: id });

	// Bake is the ONE irreversible field verb (it severs the recipe), so it goes
	// through the App-owned confirm — the same prompt the destructive scene
	// actions use, which also suppresses the global keybindings while it is open.
	// The panel owns this, not EntitiesList: a list that can sever a recipe on
	// its own click has no seam left to put a confirmation in.
	const requestBake = (id: number): void => {
		openConfirm({
			title: `Bake stamp #${id}?`,
			message:
				"Baking severs the recipe permanently: this stamp can never be reconfigured again, and its ops become plain history. Only ⌘Z reverses it, and only until the undo stack is discarded or the world is saved and reloaded.",
			confirmLabel: "Bake",
			destructive: true,
			onConfirm: () => fieldHostRef.current?.bakeEntity(id),
		});
	};

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
			<FieldToolbar
				headlamp={headlamp}
				onShading={onShading}
				onTable={setTable}
				onStatus={setStatus}
			/>
			{/* The controls stack (palette + swatches + inspectors + layers + entities)
          is BOUNDED and scrolls inside itself. Unbounded it grew with its tallest
          section — a Hall/Maze StampInspector form starved the canvas below to a
          sliver (F2b gate reject). max-h-[45%] caps it at 45% of the panel — 45 and
          not 50 so the canvas keeps the MAJORITY of the height whatever the controls
          do (the root is h-full inside a definite-height dockview panel, so the
          percentage resolves); the box still sizes to CONTENT under the cap, so a
          collapsed stack leaves no dead space. min-h-0 (redundant with the auto
          min-size an overflow!=visible flex item already gets, kept explicit) lets
          it shrink instead of pushing the canvas out, and overflow-y-auto puts the
          scroll HERE rather than on the panel. */}
			<div className="max-h-[45%] min-h-0 overflow-y-auto">
				<div className="flex flex-col gap-2 border-b border-border p-2 text-sm">
					<ToolPalette
						effect={tool.effect}
						selectionMode={selectionMode}
						generators={generators}
						onBrush={onBrush}
						onSelectionMode={onSelectionModePick}
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
					{selectionMode === null && (
						<BrushInspector
							tool={tool}
							radius={radius}
							smoothLimits={smoothLimits}
							classes={table.classes}
							onRadius={onRadius}
							onChange={pushTool}
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
				<div className="border-b border-border p-2 text-sm">
					<LayersRow
						layers={layers}
						slice={slice}
						ghostSuppressed={selectionMode !== null && stamp === null}
						onLayers={onLayers}
						onSlice={onSlice}
					/>
				</div>
				<div className="border-b border-border px-2 py-1 text-sm">
					<EntitiesList
						entities={entities}
						openEntityId={stamp?.mode === "reconfigure" ? stamp.entityId : null}
						onHighlight={(id) => fieldHostRef.current?.highlightEntity(id)}
						onReconfigure={(id) => fieldHostRef.current?.openEntity(id)}
						onFreeze={(id, frozen) =>
							fieldHostRef.current?.setEntityFrozen(id, frozen)
						}
						onBake={requestBake}
					/>
				</div>
			</div>
			{/* The FieldHost renders into this canvas. tabIndex makes it focusable so the WASD/QE
          fly + ⌘Z undo keydowns the host attaches actually reach it (Task 9 review flagged
          this as a Task 10 responsibility). Absolute-fill inside a positioned flex cell so
          the canvas always has a non-zero client box at GPU init (bindToCanvas rejects zero).
          min-h-24 is that "non-zero" as a HARD floor, not an aspiration — flex never shrinks
          an item below its min-height, so the cell keeps a 96px box at ANY panel height. It is
          load-bearing POST-init too: core's resize path floors the backing store straight off
          the CSS box (gpu/resize.ts computeResizeEvent → canvas.width = 0) and the next frame
          hands that 0 to createTexture (frame/render.ts _ensureDepthTexture) — neither clamps.
          That is a WebGPU VALIDATION error, not device loss: an invalid texture makes an
          invalid encoder, so frames break and uncaptured errors spam until the panel grows
          back, where _ensureDepthTexture's size check reallocates cleanly. NOT min-h-0:
          that reads like a floor but is the ABSENCE of one. The cell has no in-flow content (the
          canvas is absolute), so the floor is the only thing between it and zero, and it costs
          nothing above ~287px panel height, where the controls cap binds first. */}
			<div className="relative min-h-24 flex-1">
				<canvas
					ref={canvasRef}
					tabIndex={0}
					aria-label="field dig surface"
					className="absolute inset-0 h-full w-full focus:outline-none"
				/>
			</div>
			<div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground">
				<span className="tabular-nums">
					{stats.chunks} chunks · remesh {stats.lastRemeshMs.toFixed(1)}ms
				</span>
				<span className="flex items-center gap-1.5">
					{selection && (
						<span className="tabular-nums">
							{selection.count} selected
							{selection.truncated &&
								` — flood truncated at ${selection.count}`}
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
				</span>
				<span aria-live="polite">{status}</span>
			</div>
		</div>
	);
}
