import type { FieldHost } from "../../viewport-host/index.ts"; // type-only: erased

export class EngineBuildError extends Error {
  constructor(diagnostics: string) {
    super(diagnostics);
    this.name = "EngineBuildError";
  }
}

type EngineModule = {
  createFieldHost: () => FieldHost;
  extensions: Record<string, unknown>;
};

/**
 * Load the project-resolved engine bundle. fetch-first so a build failure
 * yields esbuild's diagnostics (a bare dynamic-import failure would not);
 * the import() then hits the browser cache. The variable indirection keeps
 * the bundler from trying to resolve "/engine.js" at build time.
 */
export async function loadEngine(): Promise<EngineModule> {
  const res = await fetch("/engine.js");
  if (!res.ok) throw new EngineBuildError(await res.text());
  // `: string` (not the literal type) so TS treats this as a dynamic runtime
  // specifier and does not try to resolve "/engine.js" as a module at typecheck.
  const url: string = "/engine.js";
  // Boundary cast: the runtime-built bundle's shape is known by contract (it
  // re-exports createFieldHost from
  // @furnace/editor/viewport-host and an `extensions` namespace of the consumer's
  // registration module — see daemon/bundle.ts virtual entry).
  return (await import(url)) as EngineModule;
}
