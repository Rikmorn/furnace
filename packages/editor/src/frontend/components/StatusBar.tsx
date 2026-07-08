import type { EditorState } from "../lib/state.ts";

function engineLabel(state: EditorState): string {
  if (state.status === "engine-error") return "engine: BUILD FAILED";
  if (state.status === "no-webgpu") return "engine: no WebGPU";
  return "engine: ok";
}

function sceneLabel(state: EditorState): string {
  if (state.loading) return `loading ${state.selectedScene}…`;
  if (state.doc)
    return `${state.selectedScene} · ${state.doc.entities.length} entities`;
  return "no scene";
}

function sessionLabel(state: EditorState): string | undefined {
  if (state.revision === undefined) return undefined;
  return `rev ${state.revision}${state.dirty ? " ●" : ""}`;
}

export function StatusBar({ state }: { state: EditorState }) {
  return (
    <footer className="flex gap-4 border-t border-border px-3 py-1 text-xs text-muted-foreground">
      <span>{engineLabel(state)}</span>
      {/* Data-Is-Mono: the scene path + entity count and the revision counter read as
          data — mono, tabular figures so the rev number doesn't jitter as it ticks. */}
      <span className="font-mono tabular-nums">{sceneLabel(state)}</span>
      {sessionLabel(state) && (
        <span className="font-mono tabular-nums">{sessionLabel(state)}</span>
      )}
      {state.conflict && (
        <span className="text-warning">
          file changed on disk — save to keep this session, re-open to accept
          disk
        </span>
      )}
      {state.notice && (
        <span className="truncate text-warning">{state.notice}</span>
      )}
      {state.error && (
        <span className="truncate text-destructive">{state.error}</span>
      )}
    </footer>
  );
}
