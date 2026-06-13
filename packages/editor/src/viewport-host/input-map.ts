export type DragAction = "select" | "orbit" | "pan";

/** Classify a pointer-down into a drag action (Unity-style; left reserved for editing). */
export function classifyDrag(e: {
  button: number;
  altKey: boolean;
  shiftKey: boolean;
}): DragAction {
  if (e.button === 1) return "orbit"; // middle
  if (e.button === 0 && e.altKey) return e.shiftKey ? "pan" : "orbit";
  return "select";
}
