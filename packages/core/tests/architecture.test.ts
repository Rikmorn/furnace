import { expect, test } from "bun:test";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Glob } from "bun";

// The two tiers of @furnace/core (spec: foundations program §2 D2, §4 T1a).
// World-tier modules may import engine-tier modules; NEVER the reverse.
const WORLD_TIER = new Set(["field", "registry"]);

const SRC = resolve(import.meta.dir, "../src");

type ImportEdge = {
  file: string; // src-relative path of the importing file
  line: number;
  specifier: string;
  fromModule: string; // "(root)" for files directly under src/
  toModule: string | null; // null for non-relative specifiers
  toFile: string | null; // src-relative resolved target for relative imports
};

const moduleOf = (srcRel: string): string =>
  srcRel.includes(sep) ? (srcRel.split(sep)[0] as string) : "(root)";

export async function scanImportEdges(): Promise<ImportEdge[]> {
  const edges: ImportEdge[] = [];
  // Matches `from "..."` and bare `import "..."`; type-only imports count too —
  // architecture coupling is coupling even when erased at compile time.
  const importRe = /(?:from|import)\s+["']([^"']+)["']/;
  const glob = new Glob("**/*.ts");
  for await (const f of glob.scan({ cwd: SRC })) {
    if (f.endsWith(".test.ts")) continue; // tests may deep-import freely
    const text = await Bun.file(join(SRC, f)).text();
    text.split("\n").forEach((lineText, i) => {
      // Comment lines can legitimately DISCUSS import specifiers
      // (shader/index.ts documents one in prose) — skip them.
      const trimmed = lineText.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      const m = importRe.exec(lineText);
      if (!m) return;
      const specifier = m[1] as string;
      let toModule: string | null = null;
      let toFile: string | null = null;
      if (specifier.startsWith(".")) {
        const abs = resolve(SRC, dirname(f), specifier);
        toFile = relative(SRC, abs);
        toModule = toFile.startsWith("..") ? null : moduleOf(toFile);
      }
      edges.push({
        file: f,
        line: i + 1,
        specifier,
        fromModule: moduleOf(f),
        toModule,
        toFile,
      });
    });
  }
  return edges;
}

const report = (edges: ImportEdge[]): string =>
  edges.map((e) => `  ${e.file}:${e.line} → ${e.specifier}`).join("\n");

test("engine-tier modules never import world-tier modules", async () => {
  // "(root)" files (errors.ts) count as engine tier: shared leaves that must
  // never reach upward either.
  const offenders = (await scanImportEdges()).filter(
    (e) =>
      e.toModule !== null &&
      WORLD_TIER.has(e.toModule) &&
      !WORLD_TIER.has(e.fromModule) &&
      e.fromModule !== e.toModule,
  );
  if (offenders.length > 0) {
    throw new Error(
      `engine tier must not depend on the world tier:\n${report(offenders)}`,
    );
  }
});

test("underscore-prefixed exports stay out of public module indexes", async () => {
  const offenders: string[] = [];
  const glob = new Glob("*/index.ts");
  for await (const f of glob.scan({ cwd: SRC })) {
    const text = await Bun.file(join(SRC, f)).text();
    text.split("\n").forEach((lineText, i) => {
      // Catches `_name,` inside export blocks and `export const _name`.
      if (/^\s*_[A-Za-z]|export\s+(const|function|type)\s+_/.test(lineText)) {
        offenders.push(`  ${f}:${i + 1} → ${lineText.trim()}`);
      }
    });
  }
  if (offenders.length > 0) {
    throw new Error(
      `_-prefixed names are internal plumbing, not public surface:\n${offenders.join("\n")}`,
    );
  }
});

// The four door files. A cross-module import must land on one of them: the
// public `index.ts`, the engine-private `internal.ts` siblings reach through,
// or one of the two type leaves. Anything else reaches past a module's façade
// into its implementation.
const DOOR_FILES = new Set([
  "index.ts",
  "internal.ts",
  "types.ts",
  "context-types.ts",
]);

// RATCHET. These deep imports pre-date the door rule. Entries may only ever be
// REMOVED, never added — the test below fails on a NEW deep import, and also on
// a pin whose edge is gone, because a stale pin silently re-authorizes that
// exact import the day someone writes it again. Removing one is the good
// direction and costs a one-line delete the failure message spells out.
//
// Re-derived at T2, after the scene deletion and the shader/binding seams: 68
// of 256 cross-module edges. What SHOULD replace them — a door on each shared
// value leaf (`transform/vec3.ts`, `gpu/errors.ts`, `resources/handle.ts`), a
// re-export, or accepting leaves as leaves — is the open design question in
// docs/backlog/engine-architecture/cross-module-import-doors.md.
const RATCHETED_EDGES: readonly string[] = [
  "binding/binding.ts -> resources/handle.ts",
  "binding/types.ts -> resources/handle.ts",
  "camera/bind.ts -> gpu/resize.ts",
  "camera/common.ts -> transform/mat4.ts",
  "camera/orthographic.ts -> transform/mat4.ts",
  "camera/orthographic.ts -> transform/vec3.ts",
  "camera/perspective.ts -> transform/mat4.ts",
  "camera/perspective.ts -> transform/vec3.ts",
  "camera/ray.ts -> transform/mat4.ts",
  "camera/ray.ts -> transform/vec3.ts",
  "frame/encode.ts -> gpu/errors.ts",
  "frame/loop.ts -> gpu/errors.ts",
  "frame/render-lines.ts -> gpu/dispose-cascade.ts",
  "frame/render-lines.ts -> gpu/errors.ts",
  "frame/render-lines.ts -> material/material.ts",
  "frame/render-to-texture.ts -> gpu/errors.ts",
  "frame/render-to-texture.ts -> material/material.ts",
  "frame/render-to-texture.ts -> mesh/mesh.ts",
  "frame/render-to-texture.ts -> transform/vec4.ts",
  "frame/render.ts -> gpu/dispose-cascade.ts",
  "frame/render.ts -> gpu/errors.ts",
  "frame/render.ts -> material/material.ts",
  "frame/render.ts -> mesh/instanced.ts",
  "frame/render.ts -> mesh/mesh.ts",
  "frame/render.ts -> post/effect.ts",
  "frame/render.ts -> post/evaluate.ts",
  "frame/render.ts -> post/format-bytes.ts",
  "frame/render.ts -> post/pool.ts",
  "frame/render.ts -> post/post-sampler.ts",
  "frame/render.ts -> transform/vec4.ts",
  "frame/shadow-map.ts -> gpu/dispose-cascade.ts",
  "frame/shadow-map.ts -> mesh/mesh.ts",
  "frame/shadow-projection.ts -> transform/mat4.ts",
  "frame/shadow-projection.ts -> transform/vec3.ts",
  "geometry/bounds.ts -> transform/vec3.ts",
  "geometry/types.ts -> resources/handle.ts",
  "gpu/context.ts -> resources/manager.ts",
  "gpu/context.ts -> stats/state.ts",
  "gpu/device-lost.ts -> events/emitter.ts",
  "gpu/internal.ts -> resources/manager.ts",
  "gpu/internal.ts -> stats/state.ts",
  "gpu/resize.ts -> events/emitter.ts",
  "gpu/uncaptured-error.ts -> events/emitter.ts",
  "input/state.ts -> events/emitter.ts",
  "material/internal.ts -> gpu/errors.ts",
  "material/material.ts -> texture/sampler-cache.ts",
  "material/pipeline.ts -> resources/manager.ts",
  "material/types.ts -> resources/handle.ts",
  "mesh/internal.ts -> gpu/errors.ts",
  "mesh/types.ts -> resources/handle.ts",
  "physics/types.ts -> resources/dispose.ts",
  "physics/types.ts -> resources/handle.ts",
  "post/bloom.ts -> gpu/dispose-cascade.ts",
  "post/bloom.ts -> gpu/errors.ts",
  "post/effect.ts -> gpu/errors.ts",
  "post/effect.ts -> resources/handle.ts",
  "post/evaluate.ts -> gpu/errors.ts",
  "post/fullscreen.ts -> gpu/dispose-cascade.ts",
  "post/passes.ts -> gpu/errors.ts",
  "post/pipeline-cache.ts -> resources/manager.ts",
  "post/pool.ts -> gpu/dispose-cascade.ts",
  "post/tonemap.ts -> gpu/dispose-cascade.ts",
  "rigid-mesh/rigid-mesh.ts -> resources/handle.ts",
  "rigid-mesh/types.ts -> resources/dispose.ts",
  "rigid-mesh/types.ts -> resources/handle.ts",
  "shader/types.ts -> resources/handle.ts",
  "texture/types.ts -> resources/handle.ts",
];

// Pins are written with "/" so the list reads the same on every platform.
const posix = (p: string): string => p.split(sep).join("/");

test("cross-module imports walk through the doors (ratcheted)", async () => {
  const found = (await scanImportEdges())
    .filter((e) => {
      if (e.toModule === null || e.toFile === null) return false;
      if (e.toModule === "(root)" || e.fromModule === e.toModule) return false;
      return !DOOR_FILES.has(e.toFile.split(sep).slice(1).join(sep));
    })
    .map((e) => `${posix(e.file)} -> ${posix(e.toFile as string)}`);

  const fresh = found.filter((edge) => !RATCHETED_EDGES.includes(edge));
  if (fresh.length > 0) {
    throw new Error(
      `cross-module imports must land on a door file (${[...DOOR_FILES].join(", ")}) — these reach past one:\n${fresh.map((e) => `  ${e}`).join("\n")}`,
    );
  }

  const stale = RATCHETED_EDGES.filter((pin) => !found.includes(pin));
  if (stale.length > 0) {
    throw new Error(
      `the ratchet only tightens — delete these resolved pins from RATCHETED_EDGES:\n${stale.map((e) => `  ${e}`).join("\n")}`,
    );
  }
});

// Process-global mutable state is a design decision, not a default. This pin
// is the friction: adding an entry means editing this list and justifying it
// in review. Per-context state belongs in a WeakMap<Context, …> (exempted —
// that is the house pattern, 23 sites strong). LIMITATION: this regex catches
// module-scope `let` and Map/Set containers; a mutable object literal behind
// a `const` evades it (e.g. input/state.ts's singleton — tracked by backlog
// entry input-module-pass.md, not by this test).
const PINNED_GLOBALS = [
  "frame/render-lines.ts::warnedMsaaPostChain",
  "frame/render.ts::warnedLightOverflow",
  "frame/render.ts::warnedShadowOverflow",
  "gpu/internal.ts::nextCtxId",
  "log/internal.ts::currentSink",
  "field/registry.ts::generators",
  "physics/internal.ts::initPromise",
  "registry/registry.ts::services",
];

test("module-global mutable state matches the pinned inventory", async () => {
  const found: string[] = [];
  const declRe =
    /^(?:let\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+(?:Map|Set)[<(]|createRegistry[<(]))/;
  const glob = new Glob("**/*.ts");
  for await (const f of glob.scan({ cwd: SRC })) {
    if (f.endsWith(".test.ts")) continue;
    const text = await Bun.file(join(SRC, f)).text();
    for (const lineText of text.split("\n")) {
      if (lineText.includes("WeakMap")) continue;
      const m = declRe.exec(lineText); // ^-anchored: module scope only
      if (m) found.push(`${f}::${m[1] ?? m[2]}`);
    }
  }
  expect(found.sort()).toEqual([...PINNED_GLOBALS].sort());
});

test("core never imports itself by package specifier", async () => {
  // A package-specifier self-import resolves through node_modules and is
  // invisible to relative-path reasoning — the field/artifact.ts→scene edge
  // hid exactly this way until 2026-08-04.
  const offenders = (await scanImportEdges()).filter((e) =>
    e.specifier.startsWith("@furnace/core"),
  );
  if (offenders.length > 0) {
    throw new Error(`use relative imports inside core:\n${report(offenders)}`);
  }
});
