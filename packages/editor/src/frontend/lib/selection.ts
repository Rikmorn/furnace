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
