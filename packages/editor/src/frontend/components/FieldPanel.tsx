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
// and inits the host on it. It also owns no stats, no tool-error, no entity and no
// drift subscription — all four seams are single slots the shell holds
// (useFieldHostState); subscribing to any of them here would silently steal the
// shell's callback. It has no status line either: what the editor SAYS goes to
// the notification store (toasts + the message log), which is a shell surface.
// The host is created ONCE at engine-ready (App) and reached ONLY through the
// /engine.js runtime channel (a context ref) — the chrome never value-imports
// engine code (the project-first invariant). This file type-imports the field
// host types (all erased).
import { useEffect, useState } from "react";
import type {
	FieldGeneratorInfo,
	FieldMaskChoice,
	FieldTool,
	FlagFilters,
	FlagsSummary,
	SelectionInfo,
	StampSession,
	ViewportGesture,
} from "../../viewport-host/index.ts"; // type-only: erased
import { useCatalog } from "../hooks/useCatalogs.tsx";
import { useToolErrorTick } from "../hooks/useFieldHostState.tsx";
import { useEditor } from "./editor-context.ts";
import { BrushInspector } from "./field/BrushInspector.tsx";
import { FlagsSection } from "./field/FlagsSection.tsx";
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

export function FieldPanel() {
	const { state, fieldHostRef } = useEditor();
	const [radius, setRadius] = useState(DEFAULT_RADIUS);
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
	// Range floors until the host-constants effect reads the real core ceilings.
	const [smoothLimits, setSmoothLimits] = useState({
		maxStrength: 1,
		maxIterations: 1,
	});
	// The project's material classes + the tick that says the ENTITY catalog is now on
	// the host. Both come from the shell's catalog provider: the fetch has to happen
	// whether or not this palette is open, and the world drawer needs the same result.
	const { table, entityCatalogTick } = useCatalog();
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

	// Push the panel's flag-filter defaults to the host at engine-ready. The host
	// outlives the panel (App owns it) and has no filters subscription seam, so a
	// REMOUNT resets the filters to the panel defaults — honest (the checkboxes always
	// show what the host uses) at the cost of forgetting them across a remount; the same
	// v0 trade as the one-way radius seam below. It matters in both directions: the host
	// keeps the last set ACROSS world loads, so a remounted panel showing "candidates
	// only" beside markers still drawing the info band would be a straight lie — and the
	// price of preventing it is that a remount RESETS the user's filters to candidates
	// only, ticked info band and all. Agreement over memory, deliberately; giving the
	// host a filters subscription (so the panel could adopt instead of overwrite) is what
	// would buy both.
	//
	// The layer/slice half of this block went with them to the View popover, whose
	// provider outlives every palette and pushes on change AND at engine-ready — so
	// those toggles now survive a remount instead of snapping back to the defaults. The
	// entity-highlight clear went to the palette that owns the list (EntitiesPalette).
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
		host.setFlagFilters(DEFAULT_FLAG_FILTERS);
	}, [state.status, fieldHostRef]);

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
				{/* The advisor's findings. The layer gate that draws their markers is the
            View popover's now, so this section stands on its own: it owns its border
            (the DriftReport rule) and renders nothing until something is found, so a
            world with no complaints costs no space. */}
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
