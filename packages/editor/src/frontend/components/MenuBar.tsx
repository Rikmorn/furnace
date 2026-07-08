import { useState } from "react";
import type { ViewFlags } from "../../viewport-host/index.ts"; // type-only: erased
import type { BindingAction } from "../lib/keybindings.ts";
import { PANELS, type PanelId } from "../lib/panels.ts";
import type { EditorState } from "../lib/state.ts";
import { VIEW_FLAG_ITEMS } from "../lib/view-flags.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import {
  Menubar,
  MenubarCheckboxItem,
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

/** The document-control menu bar. File▸Save/Recent, Edit, View▸Panels/Reset, and
 *  View▸View-flags (Task 9) are wired. */
export type MenuBarProps = {
  state: EditorState;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  /** dockview panel ids currently in the layout (drives the View▸Panels checkmarks). */
  openPanelIds: string[];
  onTogglePanel: (id: PanelId) => void;
  onResetLayout: () => void;
  /** Recently opened scenes, most-recent-first (File▸Recent). */
  recentScenes: string[];
  onSelectScene: (path: string) => void;
  /** Viewport view flags + toggle (Task 9). Mirrored with the viewport overlay popover —
   *  both read/write the same App-level state. */
  viewFlags: ViewFlags;
  onToggleViewFlag: (key: keyof ViewFlags, value: boolean) => void;
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

export function MenuBar({
  state,
  onSave,
  onUndo,
  onRedo,
  onDelete,
  openPanelIds,
  onTogglePanel,
  onResetLayout,
  recentScenes,
  onSelectScene,
  viewFlags,
  onToggleViewFlag,
}: MenuBarProps) {
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
            {/* Open-scene… (a file picker) is deferred; the Toolbar scene dropdown +
                Recent cover opening for now. */}
            <MenubarItem disabled>Open scene…</MenubarItem>
            <MenubarSub>
              <MenubarSubTrigger disabled={recentScenes.length === 0}>
                Recent
              </MenubarSubTrigger>
              <MenubarSubContent>
                {recentScenes.length === 0 ? (
                  <MenubarItem disabled>No recent scenes</MenubarItem>
                ) : (
                  recentScenes.map((path) => (
                    <MenubarItem key={path} onSelect={() => onSelectScene(path)}>
                      {path}
                    </MenubarItem>
                  ))
                )}
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
              <MenubarSubTrigger>Panels</MenubarSubTrigger>
              <MenubarSubContent>
                {PANELS.map((panel) => (
                  <MenubarCheckboxItem
                    key={panel.id}
                    checked={openPanelIds.includes(panel.id)}
                    // preventDefault keeps the submenu open so several panels can be
                    // toggled in one visit; the callback ignores the boolean and reads
                    // the live dockview state.
                    onSelect={(e) => {
                      e.preventDefault();
                      onTogglePanel(panel.id);
                    }}
                  >
                    {panel.title}
                  </MenubarCheckboxItem>
                ))}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSub>
              <MenubarSubTrigger>View flags</MenubarSubTrigger>
              <MenubarSubContent>
                {VIEW_FLAG_ITEMS.map(({ key, label }) => (
                  <MenubarCheckboxItem
                    key={key}
                    checked={viewFlags[key]}
                    // preventDefault keeps the submenu open so several flags can be toggled
                    // in one visit; toggle against the live flag value.
                    onSelect={(e) => {
                      e.preventDefault();
                      onToggleViewFlag(key, !viewFlags[key]);
                    }}
                  >
                    {label}
                  </MenubarCheckboxItem>
                ))}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem onSelect={onResetLayout}>Reset layout</MenubarItem>
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
