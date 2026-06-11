import type { EditorState } from "../lib/state.ts";

export function Toolbar({
  state,
  onSelectScene,
}: {
  state: EditorState;
  onSelectScene: (p: string) => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-neutral-800 px-3 py-2">
      <span className="font-semibold">furnace editor</span>
      <label className="ml-auto flex items-center gap-2 text-sm">
        scene:
        <select
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          value={state.selectedScene ?? ""}
          disabled={state.status !== "ready" || state.loading}
          onChange={(e) => e.target.value && onSelectScene(e.target.value)}
        >
          <option value="" disabled>
            {state.scenes.length ? "pick a scene" : "no scenes found"}
          </option>
          {state.scenes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}
