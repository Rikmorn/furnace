// The dockview panels the editor manages. `id` doubles as the COMPONENTS registry key
// and the panel's dockview id; `title` is the tab label. Single source of both: the
// DEFAULT layout builds from App's DEFAULT_LAYOUT_PANELS, resolving titles through
// panelTitle here.

export const PANELS = [{ id: "field", title: "Field" }] as const;

export type PanelId = (typeof PANELS)[number]["id"];

/** The tab label for a panel id (used when re-adding a single toggled-on panel). */
export function panelTitle(id: PanelId): string {
  return PANELS.find((p) => p.id === id)?.title ?? id;
}
