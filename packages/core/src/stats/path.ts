/**
 * Template-literal type that derives all valid dotted paths from a typed object.
 * Returns a union of strings — top-level keys, and `key.subkey…` chains for nested objects.
 */
export type Path<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends Record<string, unknown>
        ? `${K}` | `${K}.${Path<T[K]>}`
        : `${K}`;
    }[keyof T & string]
  : never;

/**
 * Looks up the value type at a dotted path inside a typed object.
 * Returns `never` if the path doesn't resolve.
 */
export type PathValue<T, P> = P extends keyof T
  ? T[P]
  : P extends `${infer K}.${infer Rest}`
    ? K extends keyof T
      ? PathValue<T[K], Rest>
      : never
    : never;
