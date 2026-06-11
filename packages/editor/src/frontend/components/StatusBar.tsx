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

export function StatusBar({ state }: { state: EditorState }) {
  return (
    <footer className="flex gap-4 border-t border-neutral-800 px-3 py-1 text-xs text-neutral-500">
      <span>{engineLabel(state)}</span>
      <span>{sceneLabel(state)}</span>
      {state.error && (
        <span className="truncate text-red-400">{state.error}</span>
      )}
    </footer>
  );
}
