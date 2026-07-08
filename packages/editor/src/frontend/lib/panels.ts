// The dockview panels the editor manages. `id` doubles as the COMPONENTS registry key
// and the panel's dockview id; `title` is the tab label. Single source for the default
// layout (App onReady), the View▸Panels toggles (MenuBar), and single-panel re-add.

export const PANELS = [
  { id: "entities", title: "Entities" },
  { id: "viewport", title: "Viewport" },
  { id: "inspect", title: "Inspect" },
  { id: "generation", title: "Generation" },
] as const;

export type PanelId = (typeof PANELS)[number]["id"];

/** The tab label for a panel id (used when re-adding a single toggled-on panel). */
export function panelTitle(id: PanelId): string {
  return PANELS.find((p) => p.id === id)?.title ?? id;
}
