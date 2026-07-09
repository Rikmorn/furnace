export type DragAction = "select" | "orbit" | "pan" | "fly";

/**
 * Classify a pointer-down into a drag action (Unity-style navigation):
 * right button = fly (RMB-hold flythrough), middle = pan, Alt+left = orbit
 * (Alt+Shift+left = a secondary pan), and plain left = select/gizmo.
 */
export function classifyDrag(e: {
  button: number;
  altKey: boolean;
  shiftKey: boolean;
}): DragAction {
  if (e.button === 2) return "fly"; // right → flythrough
  if (e.button === 1) return "pan"; // middle → pan (was orbit)
  if (e.button === 0 && e.altKey) return e.shiftKey ? "pan" : "orbit";
  return "select";
}
