import { useState } from "react";
import type { BindingAction } from "../lib/keybindings.ts";
import type { EditorState } from "../lib/state.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "./ui/menubar.tsx";

/** The document-control menu bar. File/Edit are wired this task; View panels/flags
 *  and File▸Open/Recent render DISABLED (owned by Tasks 6 & 9). */
export type MenuBarProps = {
  state: EditorState;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
};

/** The keyboard bindings surfaced in Help. Keyed by `BindingAction` so a new
 *  binding added to keybindings.ts is a COMPILE ERROR until it's documented here. */
const SHORTCUTS: Record<BindingAction, { label: string; keys: string }> = {
  save: { label: "Save", keys: "⌘S" },
  undo: { label: "Undo", keys: "⌘Z" },
  redo: { label: "Redo", keys: "⇧⌘Z" },
  frame: { label: "Frame selection", keys: "F" },
  delete: { label: "Delete selection", keys: "⌫" },
};

export function MenuBar({ state, onSave, onUndo, onRedo, onDelete }: MenuBarProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const hasSelection = state.selectedEntities.length > 0;

  return (
    <>
      {/* Strip the shadcn card chrome so the menu blends into the toolbar. */}
      <Menubar className="h-auto space-x-0 rounded-none border-0 bg-transparent p-0 shadow-none">
        <MenubarMenu value="file">
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled={!state.dirty} onSelect={onSave}>
              Save
              <MenubarShortcut>⌘S</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            {/* wired in Task 6 */}
            <MenubarItem disabled>Open scene…</MenubarItem>
            <MenubarSub>
              {/* wired in Task 6 */}
              <MenubarSubTrigger disabled>Recent</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem disabled>No recent scenes</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu value="edit">
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled={!state.canUndo} onSelect={onUndo}>
              Undo
              <MenubarShortcut>⌘Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled={!state.canRedo} onSelect={onRedo}>
              Redo
              <MenubarShortcut>⇧⌘Z</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem disabled={!hasSelection} onSelect={onDelete}>
              Delete
              <MenubarShortcut>⌫</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu value="view">
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarSub>
              {/* wired in Task 6 */}
              <MenubarSubTrigger disabled>Panels</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem disabled>Entities</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSub>
              {/* wired in Task 9 */}
              <MenubarSubTrigger disabled>View flags</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem disabled>Fog</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            {/* wired in Task 6 */}
            <MenubarItem disabled>Reset layout</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu value="help">
          <MenubarTrigger>Help</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => setShortcutsOpen(true)}>
              Keyboard shortcuts
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Bare keys (F, ⌫) are ignored while typing in a field.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
            {Object.values(SHORTCUTS).map((s) => (
              <div key={s.label} className="contents">
                <dt className="text-muted-foreground">{s.label}</dt>
                <dd className="font-mono tracking-widest">{s.keys}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
