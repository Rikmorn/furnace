import type { EditorState } from "../lib/state.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.tsx";

export function Toolbar({
  state,
  onSelectScene,
}: {
  state: EditorState;
  onSelectScene: (p: string) => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border px-3 py-2">
      <span className="font-semibold">furnace editor</span>
      <div className="ml-auto flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">scene:</span>
        {/* Radix Select: undefined value shows the placeholder; onValueChange fires
            only for a real item pick (so the old `e.target.value &&` guard is gone). */}
        <Select
          value={state.selectedScene ?? undefined}
          disabled={state.status !== "ready" || state.loading}
          onValueChange={onSelectScene}
        >
          <SelectTrigger className="h-8 w-56">
            <SelectValue
              placeholder={
                state.scenes.length ? "pick a scene" : "no scenes found"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {state.scenes.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </header>
  );
}
