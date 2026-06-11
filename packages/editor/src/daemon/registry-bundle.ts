import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { EditorError } from "./errors.ts";

/**
 * The slice of the consumer's `@furnace/core/scene` the daemon uses. The scene
 * modules are pure zod + data structures (no DOM/WebGPU at module top level;
 * only `loadScene` touches the GPU and the daemon never calls it), so a
 * node-platform bundle of a browser-only core imports cleanly.
 */
export type RegistryModule = {
  validateDocument(doc: unknown): void;
  introspect(): unknown;
  CURRENT_SCENE_VERSION: number;
};

export type RegistryLoader = {
  /** Fresh build + import (used by scene.open so re-opening picks up extension changes). */
  reload(): Promise<RegistryModule>;
  /** Cached module, building on first use (scene.validate / scene.introspect before any open). */
  current(): Promise<RegistryModule>;
};

/**
 * Project-first registry loader: a sibling of the browser engine bundle. The
 * virtual entry imports the consumer's extensions (registration side effects —
 * Branch A) then re-exports the daemon's needs from the consumer's own
 * `@furnace/core/scene`, all resolved from the project root's node_modules.
 */
export function createRegistryLoader(
  root: string,
  extensionsEntry: string | undefined,
): RegistryLoader {
  let cached: RegistryModule | undefined;

  async function build(): Promise<RegistryModule> {
    const importExtensions = extensionsEntry
      ? `import ${JSON.stringify(resolve(root, extensionsEntry))};\n`
      : "";
    const contents = `${importExtensions}export { validateDocument, introspect, CURRENT_SCENE_VERSION } from "@furnace/core/scene";\n`;
    // Unique filename per build: Node caches module specifiers forever, so a
    // fresh name IS the cache invalidation.
    const outfile = join(
      tmpdir(),
      `furnace-editor-registry-${randomUUID()}.mjs`,
    );
    try {
      await esbuild.build({
        stdin: {
          contents,
          resolveDir: root,
          sourcefile: "furnace-editor-registry-entry.ts",
          loader: "ts",
        },
        bundle: true,
        format: "esm",
        platform: "node",
        outfile,
        sourcemap: false,
        logLevel: "silent",
      });
    } catch (err) {
      throw new EditorError(
        "extension-build-failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    // Boundary cast: the dynamically-imported bundle's namespace is untyped;
    // the virtual entry above re-exports exactly these three names from
    // @furnace/core/scene, whose signatures RegistryModule mirrors.
    //
    // realpathSync is required: on macOS, tmpdir() returns /var/folders/...
    // but Bun's module loader canonicalises paths to /private/var/folders/...
    // On the second import() call (with a different UUID), Bun fails with
    // "Cannot find module ... from ''" unless the URL uses the canonical path.
    // The rm runs explicitly after the import resolves — not in a finally block
    // — to ensure the file exists for the full duration of module resolution.
    let mod: RegistryModule;
    try {
      const canonical = realpathSync(outfile);
      mod = (await import(pathToFileURL(canonical).href)) as RegistryModule;
    } catch (err) {
      await rm(outfile, { force: true });
      throw new EditorError(
        "extension-build-failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    await rm(outfile, { force: true });
    return {
      validateDocument: mod.validateDocument,
      introspect: mod.introspect,
      CURRENT_SCENE_VERSION: mod.CURRENT_SCENE_VERSION,
    };
  }

  return {
    async reload() {
      cached = await build();
      return cached;
    },
    async current() {
      cached ??= await build();
      return cached;
    },
  };
}
