import { resolve } from "node:path";
import * as esbuild from "esbuild";

/** Outcome of a bundle build: the ESM `code`, or an `error` string. Callers branch on `ok`. */
export type BundleResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

export type EngineBundler = {
  /** Incremental rebuild; returns the bundle, or the build error (esbuild diagnostics). */
  build(): Promise<BundleResult>;
  dispose(): Promise<void>;
};

/**
 * Create the project-first engine bundler. The virtual entry imports the
 * consumer's extensions (registration side-effects — Branch A) then re-exports
 * the viewport host; esbuild resolves EVERY import (core, extensions, zod via
 * core, the host source) from the project root's node_modules, so the bundle
 * carries exactly one core/registry/zod instance.
 */
export async function createEngineBundler(
  root: string,
  extensionsEntry: string | undefined,
): Promise<EngineBundler> {
  const importExtensions = extensionsEntry
    ? `import ${JSON.stringify(resolve(root, extensionsEntry))};\n`
    : "";
  const contents = `${importExtensions}export { createViewportHost } from "@furnace/editor/viewport-host";\n`;

  const ctx = await esbuild.context({
    stdin: {
      contents,
      resolveDir: root,
      sourcefile: "furnace-editor-engine-entry.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    write: false,
    sourcemap: "inline",
    logLevel: "silent",
  });

  return {
    async build() {
      try {
        const result = await ctx.rebuild();
        const code = result.outputFiles?.[0]?.text;
        if (code === undefined)
          return { ok: false, error: "esbuild produced no output" };
        return { ok: true, code };
      } catch (err) {
        // esbuild throws a BuildFailure whose message carries formatted
        // diagnostics (file:line + the unresolved path). Verified empirically:
        // err.message already includes the entry path, so no formatMessagesSync
        // pass is needed.
        const error = err instanceof Error ? err.message : String(err);
        return { ok: false, error };
      }
    },
    dispose: () => ctx.dispose(),
  };
}
