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

const CONFLICT_MESSAGE =
  "file changed on disk — save to keep this session, re-open to accept disk";

/** The transient conflict/notice/error text as ONE string for the sr-only live region
 *  (empty when nothing is showing). Mirrors whatever the visible spans convey. */
function liveMessage(state: EditorState): string {
  return [state.conflict ? CONFLICT_MESSAGE : "", state.notice ?? "", state.error ?? ""]
    .filter(Boolean)
    .join(" ");
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
      {/* Visible transient messages as normal footer flex items (unchanged layout). */}
      {state.conflict && <span className="text-warning">{CONFLICT_MESSAGE}</span>}
      {state.notice && (
        <span className="truncate text-warning">{state.notice}</span>
      )}
      {state.error && (
        <span className="truncate text-destructive">{state.error}</span>
      )}
      {/* Robust announcement: ONE persistent, visually-hidden live region that always
          exists in the a11y tree (`sr-only` clips it without display:none/contents, so
          VoiceOver/Safari can't strip its role). Its text changing is what announces —
          decoupled from the conditional visible spans above. */}
      <div className="sr-only" aria-live="polite">
        {liveMessage(state)}
      </div>
    </footer>
  );
}
