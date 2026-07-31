// The Field panel: what is LEFT of the dig-loop control stack. It drives the stamp
// inspector and the advisor's flags, and it owns the selection footer.
//
// The stack is dissolving, and this header is the register of where each organ went.
// What the viewport SHOWS — shading, the layer gates, the slice plane, AA — went to the
// top bar's View popover, where it is one click from anywhere instead of hidden behind a
// palette the user may have closed. The persistence concern — which world this is, Save /
// Open / Bake — is the SHELL's (the world chip, the drawer, ⌘S): a control stack that owns
// the save verb cannot be dissolved into palettes, and closing the palette holding it
// would take ⌘S with it. What the world already CONTAINS — the committed entity list and
// the drift report — is a palette of its own (shell/EntitiesPalette). And since F4.5b Task
// 8 the ARMING and the BRUSH went to the shell's own chrome: the tool families are the
// left rail (shell/ToolRail), and the armed tool's params — radius, mask, material,
// smooth, hollow — are the top strip (shell/ToolStrip), which shows them PER EFFECT
// instead of showing every control under every tool. `ToolPalette` and `BrushInspector`
// were deleted rather than moved; the swatch strip is the one piece that travelled intact.
//
// It owns NO canvas: the shell mounts the one full-window viewport (CanvasHost) and inits
// the host on it. It owns NO host subscription either — every host seam is a single slot,
// and the ten the chrome reads are all held by the shell (useFieldHostState); subscribing
// to any of them here would silently steal the shell's callback. What this file renders
// from (the live session, the advisor's flags, the cell selection) it reads out of that
// provider's contexts. It has no status line: what the editor SAYS goes to the
// notification store (toasts + the message log), which is a shell surface. The host is
// created ONCE at engine-ready (App) and reached ONLY through the /engine.js runtime
// channel (a context ref) — the chrome never value-imports engine code (the project-first
// invariant). This file type-imports the field host types (all erased).
import { useEffect, useState } from "react";
import type { FieldGeneratorInfo } from "../../viewport-host/index.ts"; // type-only: erased
import { useCatalog } from "../hooks/useCatalogs.tsx";
import {
	useFieldFlags,
	useFieldSelection,
	useFieldStamp,
} from "../hooks/useFieldHostState.tsx";
import { useEditor } from "./editor-context.ts";
import { FlagsSection } from "./field/FlagsSection.tsx";
import { StampInspector } from "./field/StampInspector.tsx";
import { Button } from "./ui/button.tsx";

export function FieldPanel() {
	const { state, fieldHostRef } = useEditor();
	// Everything host-mirrored is the SHELL's, read out of the provider's contexts (see
	// this file's header): the cell selection, the live session, and the advisor's
	// findings with the verify column that rides them.
	const { selection } = useFieldSelection();
	const { stamp } = useFieldStamp();
	const { flags, filters, setFilters, verifying, verify } = useFieldFlags();
	// Full registry info — paramSchema/defaults feed the stamp inspector's form.
	const [generators, setGenerators] = useState<FieldGeneratorInfo[]>([]);
	// The tick that says the ENTITY catalog is now on the host. It comes from the shell's
	// catalog provider: the fetch has to happen whether or not this palette is open, and
	// the world drawer needs the same result.
	const { entityCatalogTick } = useCatalog();

	// The registry, read at engine-ready (it reaches the chrome through the host because
	// the chrome cannot value-import core). NOT a constant — see the tick effect below.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready") return;
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
