import { FurnaceError } from "../errors.ts";

/**
 * A composable piece of WGSL source carrying identity + dependency edges.
 *
 * A **data** value (not a GPU resource — no handle, no lifecycle, no `destroy`):
 * author fragments, compose them with {@link source}, flatten with {@link toWgsl},
 * then compile via `shader.create`. Sits one level below the compiled {@link Shader}:
 * `ShaderSource → toWgsl() → shader.create() → Shader`.
 *
 * Identity is load-bearing: it is what lets {@link toWgsl} deduplicate a fragment
 * reached through multiple dependency paths (the diamond case), which WGSL requires
 * because it has no top-level-declaration redefinition tolerance.
 */
export type ShaderSource = {
  /** This fragment's own WGSL (scalar interpolations already inlined positionally). */
  readonly body: string;
  /** Module-scope dependency fragments — hoisted and dedup'd by {@link toWgsl}. */
  readonly deps: readonly ShaderSource[];
};

type Interpolant = ShaderSource | string | number;

// Runtime brand: `source` is the only constructor, so membership in this set is a
// reliable discriminator for "is this interpolant a ShaderSource?" — used to tell a
// dependency (hoisted) from positional text (string/number) and to reject anything else.
const instances = new WeakSet<object>();

function isShaderSource(value: unknown): value is ShaderSource {
  return typeof value === "object" && value !== null && instances.has(value);
}

function make(body: string, deps: readonly ShaderSource[]): ShaderSource {
  const src: ShaderSource = { body, deps };
  instances.add(src);
  return src;
}

function fromTemplate(
  strings: TemplateStringsArray,
  interps: readonly unknown[],
): ShaderSource {
  const deps: ShaderSource[] = [];
  let body = strings[0] ?? "";
  for (let i = 0; i < interps.length; i++) {
    const interp = interps[i];
    if (isShaderSource(interp)) {
      deps.push(interp); // hoisted dependency — not spliced positionally
    } else if (typeof interp === "string" || typeof interp === "number") {
      body += String(interp); // positional text
    } else {
      const kind = interp === undefined ? "undefined" : typeof interp;
      throw new FurnaceError(
        `shader.source: invalid interpolation at index ${i} ` +
          `(expected ShaderSource | string | number, got ${kind})`,
      );
    }
    body += strings[i + 1] ?? "";
  }
  return make(body, deps);
}

/**
 * Construct a {@link ShaderSource}. Two forms:
 *
 * - **Tagged template** — ``shader.source`fn helper() {}` ``. A `ShaderSource`
 *   interpolant becomes a hoisted, dedup'd module-scope **dependency** (its textual
 *   position is irrelevant — WGSL module scope is order-independent); a `string`/`number`
 *   interpolant is inlined as **positional text**. Any other interpolant throws.
 * - **Call form** — `shader.source(bodyText, deps?)` — for WGSL imported as text
 *   (`import src from "./x.wgsl" with { type: "text" }`), preserving native `.wgsl` tooling.
 *
 * @throws FurnaceError - on an invalid template interpolant (not ShaderSource/string/number).
 */
export function source(
  strings: TemplateStringsArray,
  ...interps: Interpolant[]
): ShaderSource;
export function source(
  body: string,
  deps?: readonly ShaderSource[],
): ShaderSource;
export function source(
  first: TemplateStringsArray | string,
  ...rest: readonly unknown[]
): ShaderSource {
  if (typeof first === "string") {
    // Boundary cast: overload-impl param erasure; the typed `source(body, deps?)`
    // overload above is the contract callers are checked against.
    const deps = (rest[0] as readonly ShaderSource[] | undefined) ?? [];
    return make(first, deps);
  }
  return fromTemplate(first, rest);
}

/**
 * Flatten a {@link ShaderSource} dependency graph into final WGSL: a post-order DFS
 * that emits each unique fragment **once** (dedup by object identity), dependencies
 * before dependents, fragments joined by a blank line. Deterministic (deps walked in
 * declaration order). No topological sort is required for correctness — WGSL module
 * scope is order-independent — post-order is chosen for readable, stable output.
 */
export function toWgsl(src: ShaderSource): string {
  const visited = new Set<ShaderSource>();
  const out: string[] = [];
  const walk = (node: ShaderSource): void => {
    if (visited.has(node)) return;
    visited.add(node);
    for (const dep of node.deps) walk(dep);
    out.push(node.body);
  };
  walk(src);
  return out.join("\n\n");
}
