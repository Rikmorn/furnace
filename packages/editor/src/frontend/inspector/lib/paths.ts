/** Read a dotted path from a params object (top-level key or nested object). */
export function getAtPath(obj: unknown, path: string): unknown {
  if (obj === null || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Immutably set a dotted path, returning a shallow-cloned object graph along the path. */
export function setAtPath(obj: unknown, path: string, value: unknown): unknown {
  const base: Record<string, unknown> =
    obj !== null && typeof obj === "object"
      ? { ...(obj as Record<string, unknown>) }
      : {};
  const parts = path.split(".");
  // Boundary cast: path.split(".") always yields ≥1 element for any string.
  const [head, ...rest] = parts as [string, ...string[]];
  if (rest.length === 0) {
    base[head] = value;
    return base;
  }
  base[head] = setAtPath(base[head], rest.join("."), value);
  return base;
}
