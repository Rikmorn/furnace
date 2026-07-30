// The shell's status bar: 28 px, opaque, fixed height — the other half of the canvas
// cell's inset budget (see TopBar).
//
// It carries three things: the viewport keymap (left), the engine/error report, and
// the live host chips (right). The chips come from `useFieldHostState`, NOT from an
// own subscription — subscribeStats is a single slot and a second subscriber would
// silently steal the first's callback.
import { useFieldHostState } from "../../hooks/useFieldHostState.tsx";
import type { EditorState } from "../../lib/state.ts";
import { useEditor } from "../editor-context.ts";

function engineLabel(state: EditorState): string {
	if (state.status === "engine-error") return "engine: BUILD FAILED";
	if (state.status === "no-webgpu") return "engine: no WebGPU";
	if (state.status === "booting") return "engine: starting…";
	return "engine: ok";
}

// The viewport's momentary bindings, verified against field-host.ts's keydown handler:
// LMB applies the armed tool, `[` / `]` step the brush radius, holding ⇧ derives the
// smooth effect and holding ⌃ swaps dig↔fill (both restore on release). Static on
// purpose — the armed tool reaches the chrome on subscribeTool, which is another
// single-slot seam the field panel already holds.
const KEYMAP = "LMB brush · [ ] radius · ⇧ smooth · ⌃ dig↔fill";

export function StatusBar({ viewportError }: { viewportError: string | null }) {
	const { state } = useEditor();
	const { stats } = useFieldHostState();
	const error = state.error ?? viewportError;

	return (
		<footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-xs text-muted-foreground">
			<span className="whitespace-nowrap">{KEYMAP}</span>
			{error && <span className="truncate text-destructive">{error}</span>}
			<div className="flex-1" />
			{stats && (
				<span className="flex items-center gap-3 tabular-nums">
					<span>{stats.totalOps} ops</span>
					{/* The advisor's one-liner: `analyzerPending` counts PASSES owed (0–2), not
              chunks, so the chip says only that it is behind. Absent at 0 — an idle
              advisor is the normal state and has nothing to report. */}
					{stats.analyzerPending > 0 && (
						<span title="the walkability advisor is catching up with your edits">
							analyzer ●
						</span>
					)}
					<span>undo {stats.undoDepth}</span>
				</span>
			)}
			<span className="whitespace-nowrap">{engineLabel(state)}</span>
			{/* Robust announcement: ONE persistent, visually-hidden live region that always
          exists in the a11y tree (`sr-only` clips it without display:none/contents, so
          VoiceOver/Safari can't strip its role). Its text changing is what announces —
          decoupled from the conditional visible span above. */}
			<div className="sr-only" aria-live="polite">
				{error ?? ""}
			</div>
		</footer>
	);
}
