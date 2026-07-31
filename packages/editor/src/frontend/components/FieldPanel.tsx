// The Field panel: what is LEFT of the dig-loop control stack — the advisor's flags, and
// the selection footer. Two organs, and both are booked to leave (Tasks 13 and 14).
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
// Task 10 took the PROPERTIES concern with the same treatment: `StampInspector` was
// deleted, not moved, and the session card (shell/SessionCard) is its successor — a
// palette of its own whose open state the editor drives, with a REST state the inspector
// never had. The generator-registry read went with it.
//
// It owns NO canvas: the shell mounts the one full-window viewport (CanvasHost) and inits
// the host on it. It owns NO host subscription either — every host seam is a single slot,
// and the eleven the chrome reads are all held by the shell (useFieldHostState);
// subscribing to any of them here would silently steal the shell's callback. What this
// file renders from (the advisor's flags, the cell selection) it reads out of that
// provider's contexts. It has no status line: what the editor SAYS goes to the
// notification store (toasts + the message log), which is a shell surface. The host is
// created ONCE at engine-ready (App) and reached ONLY through the /engine.js runtime
// channel (a context ref) — the chrome never value-imports engine code (the project-first
// invariant). This file type-imports the field host types (all erased).
import {
	useFieldFlags,
	useFieldSelection,
} from "../hooks/useFieldHostState.tsx";
import { useEditor } from "./editor-context.ts";
import { FlagsSection } from "./field/FlagsSection.tsx";
import { Button } from "./ui/button.tsx";

export function FieldPanel() {
	const { state, fieldHostRef } = useEditor();
	// Everything host-mirrored is the SHELL's, read out of the provider's contexts (see
	// this file's header): the cell selection, and the advisor's findings with the verify
	// column that rides them.
	const { selection } = useFieldSelection();
	const { flags, filters, setFilters, verifying, verify } = useFieldFlags();

	if (state.status !== "ready") {
		return (
			<p className="p-3 text-sm text-muted-foreground">
				the field waits for the engine bundle…
			</p>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{/* What is LEFT of the controls stack takes whatever height the selection footer
          below leaves, and scrolls INSIDE itself. min-h-0 is what lets a flex child
          shrink below its content instead of pushing the footer off the bottom. */}
			<div className="min-h-0 flex-1 overflow-y-auto">
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
