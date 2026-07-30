import type { EditorState } from "../lib/state.ts";

function engineLabel(state: EditorState): string {
	if (state.status === "engine-error") return "engine: BUILD FAILED";
	if (state.status === "no-webgpu") return "engine: no WebGPU";
	return "engine: ok";
}

export function StatusBar({ state }: { state: EditorState }) {
	return (
		<footer className="flex gap-4 border-t border-border px-3 py-1 text-xs text-muted-foreground">
			<span>{engineLabel(state)}</span>
			{state.error && (
				<span className="truncate text-destructive">{state.error}</span>
			)}
			{/* Robust announcement: ONE persistent, visually-hidden live region that always
          exists in the a11y tree (`sr-only` clips it without display:none/contents, so
          VoiceOver/Safari can't strip its role). Its text changing is what announces —
          decoupled from the conditional visible span above. */}
			<div className="sr-only" aria-live="polite">
				{state.error ?? ""}
			</div>
		</footer>
	);
}
