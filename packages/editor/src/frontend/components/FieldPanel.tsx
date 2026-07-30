// The Field panel (F1/F2b): the dig-loop CONTROL STACK. It drives the tool
// palette (brush effects, selection gestures, stamp generators) + the persistent
// material swatches + the brush inspector (radius/mask/smooth/hollow) + shading
// + the layers/slice row, the advisor's flags, the entity list and the drift
// report. The persistence concern — which world this is, Save / Open / Bake —
// is the SHELL's now (the world chip, the drawer, ⌘S): a control stack that owns
// the save verb cannot be dissolved into palettes, and closing the palette
// holding it would take ⌘S with it. The material table it renders swatches from
// arrives the same way, off the catalog provider the shell mounts.
// It owns NO canvas: the shell mounts the one full-window viewport (CanvasHost)
// and inits the host on it. It also owns no stats and no tool-error
// subscription — both seams are single slots the shell holds
// (useFieldHostState); subscribing to either here would silently steal the
// shell's callback. It has no status line either: what the editor SAYS goes to
// the notification store (toasts + the message log), which is a shell surface.
// The host is created ONCE at engine-ready (App) and reached ONLY through the
// /engine.js runtime channel (a context ref) — the chrome never value-imports
// engine code (the project-first invariant). This file type-imports the field
// host + artifact types (all erased).
import type { DriftFinding } from "@furnace/core/field"; // type-only: erased
import { useCallback, useEffect, useState } from "react";
import type {
	FieldEntityInfo,
	FieldGeneratorInfo,
	FieldHostShading,
	FieldLayers,
	FieldMaskChoice,
	FieldTool,
	FlagFilters,
	FlagsSummary,
	PlacedArchetype,
	SelectionInfo,
	StampSession,
	ViewportGesture,
} from "../../viewport-host/index.ts"; // type-only: erased
import { useCatalog } from "../hooks/useCatalogs.tsx";
import { useToolErrorTick } from "../hooks/useFieldHostState.tsx";
import { useEditor } from "./editor-context.ts";
import { BrushInspector } from "./field/BrushInspector.tsx";
import { DriftReport } from "./field/DriftReport.tsx";
import { EntitiesList } from "./field/EntitiesList.tsx";
import { FlagsSection } from "./field/FlagsSection.tsx";
import { LayersRow } from "./field/LayersRow.tsx";
import { MaterialSwatches } from "./field/MaterialSwatches.tsx";
import { StampInspector } from "./field/StampInspector.tsx";
import { ToolPalette } from "./field/ToolPalette.tsx";
import { Button } from "./ui/button.tsx";

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

// Panel-side layer defaults — mirror the host's own all-true default (a local
// literal for the same reason as DEFAULT_TOOL: the chrome cannot value-import
// the host). Pushed to the host at engine-ready so both start in agreement.
const DEFAULT_LAYERS: FieldLayers = {
	field: true,
	kit: true,
	props: true,
	ghost: true,
	selection: true,
	grid: true,
	flags: true,
	// The one default-off flag: ticking it runs a whole-world cast job, so the
	// X-ray is opt-in (mirrors the host's own default).
	voidCast: false,
};

// Slice defaults: OFF, plane parked at 8 m — mid-range of the slider (LayersRow
// owns the −8…+24 range), high enough to cut a typical kit hall when enabled.
const SLICE_DEFAULT_Y = 8;

// Panel-side advisor-filter defaults — candidates only, mirroring the host's own
// DEFAULT_FLAG_FILTERS. A local literal for the DEFAULT_LAYERS reason (the chrome
// cannot value-import the host), pushed at engine-ready so the checkboxes and the
// markers agree. CONSEQUENCE, stated plainly because someone will hit it: the
// panel REMOUNTING resets the filters to candidates only, discarding whatever the
// user last ticked — see the push site's comment. Nothing in the shell remounts it
// today (the dock tab switch that used to is gone), which makes this latent rather
// than fixed: moving the flags section into a palette brings it straight back.
const DEFAULT_FLAG_FILTERS: FlagFilters = {
	candidates: true,
	info: false,
	unreachable: false,
};

// Nothing found yet — what the panel renders between its first ready render and
// the subscribe effect that follows it, after which every summary is the host's.
const NO_FLAGS: FlagsSummary = { total: 0, byKindSeverity: [], visible: [] };

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
// id + generator + seed + opSpan + the two state flags + the `placed` counts.
//
// `placed` is compared DIRECTLY rather than inferred from opSpan, and the reason
// is a fact that is easy to get wrong: op ids do NOT only ever grow. Core hands
// them out monotonically WITHIN a session, but `loadWorld` recomputes
// `log.nextId` from the loaded ops' own maximum (field-host.ts, the parseOps
// path), so ids — and with them every opSpan — RESTART across a world switch.
// Two worlds whose rows agree on id/generator/seed/span/flags and differ only in
// what a scatter placed are therefore reachable from the toolbar's Load button,
// which calls loadWorld inside this same panel mount: no remount, no state
// reset, just an entity tick. Without the `placed` comparison this guard returns
// `prev` and the row keeps the PREVIOUS world's count. (Params are the same
// shape and still uncompared — pre-existing, filed as
// `docs/backlog/editor-and-tooling/entity-row-params-stale-across-load.md`.)
//
// The flags DO need their own comparison too — freeze and bake rewrite the
// record and nothing else, so without them a frozen badge would never appear.
// Index-wise, not set-wise: `rowSummary` renders `placed` in ARRAY order, so a
// reordering changes the row string and must re-render.
const samePlaced = (
	a: readonly PlacedArchetype[],
	b: readonly PlacedArchetype[],
): boolean =>
	a.length === b.length &&
	a.every((p, i) => {
		const o = b[i];
		return (
			o !== undefined && p.archetypeId === o.archetypeId && p.count === o.count
		);
	});

const sameEntities = (a: FieldEntityInfo[], b: FieldEntityInfo[]): boolean =>
	a.length === b.length &&
	a.every((e, i) => {
		const o = b[i];
		if (o === undefined) return false;
		// Compiler backstop — the toolsEqual/statsEqual rider, and the one THIS
		// comparator was missing when the `placed` hole shipped. FieldEntityInfo is
		// an intersection over CORE's GeneratorEntity, so a field added there lands
		// here silently and no test can exist for a field nobody knew to compare;
		// destructuring every one makes the compiler force the question.
		//
		// The three voided below are deliberate non-compares: `type` is the constant
		// literal "generator"; `region` is never rendered by a row (the highlight box
		// is drawn from the HOST's own record, off an id); and `params` is the known
		// pre-existing hole, filed as
		// `docs/backlog/editor-and-tooling/entity-row-params-stale-across-load.md`.
		const {
			entityId,
			type,
			generator,
			params,
			seed,
			region,
			opSpan,
			frozen,
			baked,
			placed,
			...rest
		} = e;
		void (rest satisfies Record<string, never>);
		void type;
		void params;
		void region;
		return (
			entityId === o.entityId &&
			generator === o.generator &&
			seed === o.seed &&
			opSpan[0] === o.opSpan[0] &&
			opSpan[1] === o.opSpan[1] &&
			frozen === o.frozen &&
			baked === o.baked &&
			samePlaced(placed, o.placed)
		);
	});

export function FieldPanel() {
	const { state, fieldHostRef, openConfirm } = useEditor();
	const [radius, setRadius] = useState(DEFAULT_RADIUS);
	const [headlamp, setHeadlamp] = useState(false);
	const [tool, setToolState] = useState<FieldTool>(DEFAULT_TOOL);
	// ONE armed-gesture slot, mirroring the host's (ViewportGesture): the three
	// selection gestures and the segment brush all bind LMB, so they cannot be
	// armed independently. `selectionArmed` is the narrower question the two
	// brush-facing gates below ask — the segment gesture keeps LMB on the brush,
	// so it must NOT hide the brush inspector or grey the ghost toggle.
	const [gesture, setGestureState] = useState<ViewportGesture | null>(null);
	const selectionArmed = gesture !== null && gesture !== "segment";
	const [selection, setSelection] = useState<SelectionInfo | null>(null);
	// Full registry info — paramSchema/defaults feed the stamp inspector's form.
	const [generators, setGenerators] = useState<FieldGeneratorInfo[]>([]);
	const [stamp, setStamp] = useState<StampSession | null>(null);
	const [entities, setEntities] = useState<FieldEntityInfo[]>([]);
	const [layers, setLayers] = useState<FieldLayers>(DEFAULT_LAYERS);
	const [slice, setSlice] = useState({ enabled: false, y: SLICE_DEFAULT_Y });
	// Range floors until the host-constants effect reads the real core ceilings.
	const [smoothLimits, setSmoothLimits] = useState({
		maxStrength: 1,
		maxIterations: 1,
	});
	// The project's material classes + the tick that says the ENTITY catalog is now on
	// the host. Both come from the shell's catalog provider: the fetch has to happen
	// whether or not this palette is open, and the world drawer needs the same result.
	const { table, entityCatalogTick } = useCatalog();
	// The last reconfigure's drift report (null = clean / none). Non-modal: it
	// renders (via DriftReport) only while findings exist.
	const [drift, setDrift] = useState<DriftFinding[] | null>(null);
	// The advisor's findings + the bands the panel asks for. The summary is the
	// host's (filters already applied); the filter set is panel state pushed
	// through setFlagFilters, the layers/slice precedent.
	const [flags, setFlags] = useState<FlagsSummary>(NO_FLAGS);
	const [flagFilters, setFlagFilters] =
		useState<FlagFilters>(DEFAULT_FLAG_FILTERS);
	// The row key stage 2 is running on (null = none). PANEL state, not the
	// host's, because releasing it takes two signals no single host seam carries:
	// a verdict arrives on subscribeFlags, and each of `verifyFlag`'s refusals
	// arrives on the tool-error seam having pushed no flags at all. Adopted here
	// on the click for the same reason — `verifyFlag` is fire-and-forget.
	const [verifying, setVerifying] = useState<string | null>(null);
	// The refusal half of that release. The SEAM is the shell's now (single slot,
	// one subscriber — the provider, which turns each refusal into a toast); what
	// reaches here is only the fact that one happened, which is all this needs.
	const toolErrorTick = useToolErrorTick();

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

	// Push the panel's layer/slice/flag-filter view defaults to the host at
	// engine-ready, and drop any entity-highlight box when the panel unmounts. The
	// host outlives the panel (App owns it) and has no layers/slice/filters/
	// highlight subscription seam, so a REMOUNT resets all of them to the panel
	// defaults — honest (the controls always show what the host uses) at the cost
	// of forgetting the toggles across a remount; the same v0 trade as the
	// one-way radius seam below. The filters matter most here, in both directions:
	// the host keeps the last set ACROSS world loads, so a remounted panel showing
	// "candidates only" beside markers still drawing the info band would be a
	// straight lie — and the price of preventing it is that a remount RESETS the
	// user's filters to candidates only, ticked info band and all. Agreement over
	// memory, deliberately; giving the host a filters subscription (so the panel
	// could adopt instead of overwrite) is what would buy both. The highlight clear
	// keeps a remounted list (expansion state reset) from standing next to a box no
	// row claims.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		host.setLayers(DEFAULT_LAYERS);
		host.setSlice(null);
		host.setFlagFilters(DEFAULT_FLAG_FILTERS);
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

	// A host refusal releases any verify the panel thinks is running. Every
	// `verifyFlag` refusal reports on the tool-error seam having pushed no flags,
	// so this is the only signal that a verify the user started never actually
	// began; without it the column would read "Verifying…" until the next
	// analyzer response.
	//
	// Deliberately blunt: an UNRELATED tool error (a failed stroke) also releases
	// it. That way round is the safe one — the host still refuses a real second
	// verify with "a verify is already running", so the cost is a button that
	// looks live for a moment, against a column that sticks for good.
	//
	// The tick, not a message: the refusal's TEXT is already on screen as a toast
	// (the provider posts it), and mirroring it into panel state would be a second
	// copy to keep in agreement. The zero guard is what makes the dependency the
	// effect's actual SUBJECT rather than a bare trigger — at mount nothing has been
	// refused yet, so there is nothing to release.
	useEffect(() => {
		if (toolErrorTick === 0) return;
		setVerifying(null);
	}, [toolErrorTick]);

	// The reconfigure drift report. subscribeDrift pushes clones + the current
	// report on subscribe (a panel remount after an apply keeps its findings);
	// dismiss/reset/load push null through the same seam, so setDrift is the
	// whole mirror.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		return host.subscribeDrift(setDrift);
	}, [state.status, fieldHostRef]);

	// The advisor's findings. Pushed after every analyzer response and every
	// setFlagFilters (plus the current summary on subscribe, so a remount mid-dig
	// re-renders the list it left). Answer-paced, not frame-paced — which is why,
	// unlike the stats mirror beside it, this needs no value-equality guard.
	//
	// Any push releases the in-flight verify, not just the one carrying its
	// verdict: a re-analysis that landed mid-verify may have replaced the row the
	// key names, so holding the column against a row that no longer exists would
	// disable every Verify in the list with no way back.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		return host.subscribeFlags((summary) => {
			setFlags(summary);
			setVerifying(null);
		});
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

	const onFlagFilters = (next: FlagFilters): void => {
		setFlagFilters(next);
		fieldHostRef.current?.setFlagFilters(next);
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
			{/* The controls stack (palette + swatches + inspectors + layers + entities)
          takes whatever height the selection footer below leaves, and scrolls INSIDE
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
						ghostSuppressed={selectionArmed && stamp === null}
						headlamp={headlamp}
						onLayers={onLayers}
						onSlice={onSlice}
						onShading={onShading}
					/>
				</div>
				{/* The advisor's findings, under the layer toggle that draws their
            markers. Owns its border (the DriftReport rule) and renders nothing
            until something is found, so a world with no complaints costs no
            space. */}
				<FlagsSection
					summary={flags}
					filters={flagFilters}
					onFilters={onFlagFilters}
					onFrame={(chunks) => fieldHostRef.current?.frameChunks(chunks)}
					verifying={verifying}
					onVerify={(key) => {
						// Adopt BEFORE the call, never after: ALL FOUR of the host's
						// refusals are decided synchronously and report on the tool-error
						// seam from inside `verifyFlag` (only a stage-2 FAILURE is async),
						// so a write afterwards would overwrite the release that refusal
						// just performed and leave the column stuck on a verify that never
						// ran.
						setVerifying(key);
						fieldHostRef.current?.verifyFlag(key);
					}}
				/>
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
				{/* The reconfigure drift report — renders (DriftReport → null when
            empty) only while findings exist, beside the entities it describes.
            Owns its own border, so no empty section shows on a clean apply. */}
				<DriftReport
					findings={drift ?? []}
					onFrame={(f) => fieldHostRef.current?.frameChunks(f.chunks)}
					onDismiss={() => fieldHostRef.current?.dismissDrift()}
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
