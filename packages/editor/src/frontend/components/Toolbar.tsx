import { Redo2, Save, Undo2 } from "lucide-react";
import type { EditorState } from "../lib/state.ts";
import { MenuBar } from "./MenuBar.tsx";
import { Button } from "./ui/button.tsx";
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
  onSave,
  onUndo,
  onRedo,
  onDelete,
}: {
  state: EditorState;
  onSelectScene: (p: string) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
}) {
  return (
    <header className="flex items-center gap-1 border-b border-border px-3 py-1.5">
      {/* The wordmark shrinks to a compact mark; the menu + controls own the left. */}
      <span
        className="select-none pr-1 text-sm font-semibold tracking-tight"
        title="furnace editor"
      >
        furnace
      </span>
      <MenuBar
        state={state}
        onSave={onSave}
        onUndo={onUndo}
        onRedo={onRedo}
        onDelete={onDelete}
      />
      <div className="ml-2 flex items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="relative h-8 w-8"
          title="Save (⌘S)"
          aria-label="Save"
          disabled={!state.dirty}
          onClick={onSave}
        >
          <Save />
          {state.dirty && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="Undo (⌘Z)"
          aria-label="Undo"
          disabled={!state.canUndo}
          onClick={onUndo}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="Redo (⇧⌘Z)"
          aria-label="Redo"
          disabled={!state.canRedo}
          onClick={onRedo}
        >
          <Redo2 />
        </Button>
      </div>
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
