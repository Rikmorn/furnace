import { expect, test } from "bun:test";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Glob } from "bun";

// The two tiers of @furnace/core (spec: foundations program §2 D2, §4 T1a).
// World-tier modules may import engine-tier modules; NEVER the reverse.
const WORLD_TIER = new Set(["field", "registry", "scene"]);

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
  "scene/registry.ts::components",
  "scene/registry.ts::resources",
  "scene/registry.ts::settingsSchema",
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
