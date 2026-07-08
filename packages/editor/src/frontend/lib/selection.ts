/** Selection sentinel for the World / scene-settings row (EntitiesPanel). It is NOT a doc
 *  entity — it is a virtual single-select value that routes the inspector to the settings
 *  form. The reducer preserves it across refreshes; App filters it out of the viewport
 *  highlight + delete paths (it has no 3D presence and can't be deleted). */
export const SETTINGS_SELECTION = "$settings";

/** Map pointer modifier keys to a selection mode. Shift (range) wins over cmd/ctrl (toggle). */
export function clickMode(mods: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): "replace" | "toggle" | "range" {
  if (mods.shiftKey) return "range";
  if (mods.metaKey || mods.ctrlKey) return "toggle";
  return "replace";
}
