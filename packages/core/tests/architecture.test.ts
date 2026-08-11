import { expect, test } from "bun:test";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Glob } from "bun";

// The two tiers of @furnace/core (spec: foundations program §2 D2, §4 T1a).
// World-tier modules may import engine-tier modules; NEVER the reverse.
const WORLD_TIER = new Set(["field", "registry"]);

const SRC = resolve(import.meta.dir, "../src");

type ImportEdge = {
  file: string; // src-relative path of the importing file
  line: number; // 1-based line the STATEMENT starts on
  specifier: string;
  fromModule: string; // "(root)" for files directly under src/
  toModule: string | null; // null for non-relative specifiers
  toFile: string | null; // src-relative resolved target for relative imports
  names: string[]; // names taken FROM the target; [] for namespace/bare imports
  typeOnly: boolean; // statement-level `import type` / `export type`
  namespace: boolean; // `import * as ns` — takes the module wholesale
};

const moduleOf = (srcRel: string): string =>
  srcRel.includes(sep) ? (srcRel.split(sep)[0] as string) : "(root)";

/**
 * Overwrite every comment with spaces, preserving offsets and newlines so
 * statement line numbers stay exact. Two things need this: a comment may
 * legitimately DISCUSS an import specifier (shader/index.ts documents one in
 * prose), and a `//` inside a string literal must not eat the rest of the line.
 */
function blankComments(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (two === "/*") {
      let j = i + 2;
      while (j < src.length && src.slice(j, j + 2) !== "*/") j++;
      blank(i, Math.min(j + 2, src.length));
      i = j + 2;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const quote = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j += src[j] === "\\" ? 2 : 1;
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

// An element of an import list carries more than its name: an inline `type`
// modifier (`{ a, type B }`) and an alias (`{ a as b }`). The name that has to
// exist on the TARGET's surface is what's left after stripping both — the alias
// is the local binding, not something the target declares.
const importedName = (element: string): string =>
  (element.replace(/^type\s+/, "").split(/\s+as\s+/)[0] as string).trim();

type ImportClause = Pick<ImportEdge, "names" | "typeOnly" | "namespace">;

function parseImportClause(clause: string): ImportClause {
  const typeOnly = /^type\b/.test(clause.trim());
  const rest = clause.trim().replace(/^type\b\s*/, "");
  if (/(^|,)\s*\*\s*as\b/.test(rest)) {
    return { names: [], typeOnly, namespace: true };
  }
  const list = /\{([\s\S]*)\}/.exec(rest);
  if (list === null) {
    // Default import (`import RAPIER from "…"`), or a bare side-effect import
    // whose clause is empty.
    return { names: rest === "" ? [] : [rest], typeOnly, namespace: false };
  }
  const names = (list[1] as string)
    .split(",")
    .map((element) => element.trim())
    .filter((element) => element !== "") // trailing comma
    .map(importedName);
  // `import Default, { a } from "…"` — the default binding sits before the list.
  const beforeList = rest.slice(0, list.index).replace(/,\s*$/, "").trim();
  if (beforeList !== "") names.push(beforeList);
  return { names, typeOnly, namespace: false };
}

// Whole statements, not lines: 5 of core's cross-module imports span several
// lines, and a per-line scanner cannot see the names inside them. `[^;]` keeps
// a clause from running past the end of its own statement. `export … from` is
// matched too — a re-export takes names from the target exactly like an import.
const STATEMENT_RE =
  /^[ \t]*(?:import|export)\s+(?:([^;]*?)\s*\bfrom\b\s*)?["']([^"']+)["']/gm;

export async function scanImportEdges(): Promise<ImportEdge[]> {
  const edges: ImportEdge[] = [];
  const glob = new Glob("**/*.ts");
  for await (const f of glob.scan({ cwd: SRC })) {
    if (f.endsWith(".test.ts")) continue; // tests may deep-import freely
    const text = blankComments(await Bun.file(join(SRC, f)).text());
    STATEMENT_RE.lastIndex = 0;
    let m = STATEMENT_RE.exec(text);
    while (m !== null) {
      const specifier = m[2] as string;
      let toModule: string | null = null;
      let toFile: string | null = null;
      if (specifier.startsWith(".")) {
        const abs = resolve(SRC, dirname(f), specifier);
        toFile = relative(SRC, abs);
        toModule = toFile.startsWith("..") ? null : moduleOf(toFile);
      }
      edges.push({
        file: f,
        line: text.slice(0, m.index).split("\n").length,
        specifier,
        fromModule: moduleOf(f),
        toModule,
        toFile,
        ...parseImportClause(m[1] ?? ""),
      });
      m = STATEMENT_RE.exec(text);
    }
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
      // Three shapes: `_name,` on its own line inside a multi-line export
      // block; a local `export const/function/type _name`; and a SINGLE-LINE
      // `export { _name } from "…"` (or `export type { _Name }`), which the
      // first two miss because the name is neither at line start nor after a
      // declaration keyword. Found 2026-08-11 by sabotaging this pin during
      // the T5 surface audit — the audit's whole `_`-leak argument leans on
      // this test being the boundary, and in that shape it was not.
      if (
        /^\s*_[A-Za-z]|export\s+(const|function|type)\s+_|export\s+(?:type\s+)?\{[^}]*\b_[A-Za-z]/.test(
          lineText,
        )
      ) {
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

// The two doors. A module's contract is what it DECLARES: the public `index.ts`
// and the engine-private `internal.ts` siblings reach through. An import landing
// on either is legal by construction — that is what a door is for.
const DOOR_LEAVES = new Set(["index.ts", "internal.ts"]);

// The two type leaves. A type-only import of these is legal without the name
// being re-exported: they carry no runtime coupling, and `Context` in particular
// is threaded through every module's signatures.
const TYPE_LEAVES = new Set(["types.ts", "context-types.ts"]);

// Pins and paths are written with "/" so messages read the same on every platform.
const posix = (p: string): string => p.split(sep).join("/");

// The leaf of a src-relative target path, module segment dropped:
// "resources/handle.ts" -> "handle.ts".
const leafOf = (srcRel: string): string => srcRel.split(sep).slice(1).join(sep);

/**
 * Every name a door file declares. Handles the export forms that occur in
 * core's door files: `export { a, type B, c as d } from`, `export type { A }
 * from`, the bare `export { X };`, multi-line lists with trailing commas, and
 * local declarations (`disposeAll` and every seam accessor is one).
 *
 * For an export the declared name is the ALIAS (`a as b` declares `b`) — the
 * mirror of {@link importedName}, which wants the pre-`as` side.
 */
function declaredNames(src: string, where: string): string[] {
  const text = blankComments(src);
  if (/\bexport\s+\*/.test(text)) {
    throw new Error(
      `unsupported export form in a door file (${where}): \`export *\` means the ` +
        "surface is whatever some other file happens to export — list the names.",
    );
  }
  const names: string[] = [];
  const listRe = /\bexport\s+(?:type\s+)?\{([\s\S]*?)\}/g;
  let list = listRe.exec(text);
  while (list !== null) {
    for (const element of (list[1] as string).split(",")) {
      const trimmed = element.trim().replace(/^type\s+/, "");
      if (trimmed === "") continue; // trailing comma
      const parts = trimmed.split(/\s+as\s+/);
      names.push((parts[parts.length - 1] as string).trim());
    }
    list = listRe.exec(text);
  }
  const declRe =
    /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/g;
  let decl = declRe.exec(text);
  while (decl !== null) {
    names.push(decl[1] as string);
    decl = declRe.exec(text);
  }
  return names;
}

const surfaces = new Map<string, Set<string>>();

/** The union of a module's declared surface: `index.ts` names ∪ `internal.ts` names. */
async function surfaceOf(module: string): Promise<Set<string>> {
  const cached = surfaces.get(module);
  if (cached !== undefined) return cached;
  const surface = new Set<string>();
  for (const door of DOOR_LEAVES) {
    const file = Bun.file(join(SRC, module, door));
    if (!(await file.exists())) continue;
    for (const name of declaredNames(await file.text(), `${module}/${door}`)) {
      surface.add(name);
    }
  }
  surfaces.set(module, surface);
  return surface;
}

// The door rule, by NAME rather than by path. The path was always a proxy: what
// actually matters is whether the target module DECLARED the thing being taken.
// Declaring a name on internal.ts is a deliberate act that makes every import of
// it legal, whatever file path the importer spells; a name on neither surface is
// an ownership question nobody has answered. See api-posture.md §R8.
test("cross-module imports take only names the target module declares", async () => {
  const offenders: string[] = [];
  for (const e of await scanImportEdges()) {
    if (e.toModule === null || e.toFile === null) continue;
    if (e.toModule === "(root)" || e.fromModule === e.toModule) continue;
    const leaf = leafOf(e.toFile);
    if (DOOR_LEAVES.has(leaf)) continue;
    const where = `${posix(e.file)}:${e.line} -> ${posix(e.toFile)}`;
    if (e.namespace) {
      offenders.push(`  ${where} — reaches past the module facade wholesale`);
      continue;
    }
    if (e.typeOnly && TYPE_LEAVES.has(leaf)) continue;
    const surface = await surfaceOf(e.toModule);
    const undeclared = e.names.filter((n) => !surface.has(n));
    if (undeclared.length > 0) {
      offenders.push(`  ${where} — ${undeclared.join(", ")}`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      "these imports take names the target module never declared:\n" +
        `${offenders.join("\n")}\n\n` +
        "For each name: promote it to index.ts (a public API decision), declare " +
        "it in internal.ts (the package-private seam), or stop importing it — a " +
        "name's absence from both surfaces is the question; see api-posture.md §R8.",
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
