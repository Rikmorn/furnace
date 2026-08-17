import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
// The traversal, shared with `no-chrome-leakage.test.ts`, `frontend-no-engine-leakage.test.ts`
// and `actions.test.ts` — the RULES stay here, where the argument for them is.
import { walk } from "./_source-scan.ts";

// THE ASSEMBLY BOUNDARY INSIDE `src/field-host/`, which until now was held by nothing.
//
// The sibling guards (`no-chrome-leakage.test.ts`, `frontend-no-engine-leakage.test.ts`) hold
// the editor's LAYER arrow — `frontend/ → { field-host/, action-registry/ } → shared/`. Neither
// says anything about the inside of `field-host/`, and the inside is where foundations T3
// spent six tranches: twenty-one modules lifted out of one closure, each handed what it needs
// through its own `*Deps` record, all of it wired by `createFieldHost`. That shape is a
// star, and a star only stays one while nobody takes a shortcut across it.
//
// WHAT THE MAP ACTUALLY MEASURED, stated exactly, because the obvious paraphrase is wrong.
// `docs/reference/field-host-clusters.md` §5.7 closes with "zero remain cluster-to-cluster
// inside the closure" — that is the CROSS-CLUSTER MUTATION register, 59 standing write edges
// of which all 59 now cross a module line. It is a measurement of who WRITES whose state, not
// of who IMPORTS whom, and the map never measured the import graph at all. So this file does
// not turn that 0 into a gate; it gates the MECHANISM the map describes those 59 edges
// travelling through, which §5.5 and editor-architecture §20.3 both spell the same way:
//
//   `field-picking.ts` reaches `field-machine.ts` through the arrow pair in its deps record
//   `field-view.ts`'s two deps are VERBS on another extracted module (voidcast's discard/request)
//
// A module receives a peer's verbs as arrows the FACADE puts in its deps record. It does not
// reach for them by import. That is the invariant with teeth: an import edge is a coupling
// nobody assembled, and once one exists the deps records stop describing the graph.
//
// THE ALLOWED EDGES, re-derived from the map rather than from the shape it suggests:
//   - a seam module may import the SHARED SEAMS and the PURE modules beside it —
//     `substrate.ts`, `view-channel.ts`, `input-router.ts`, the two worker-protocol pairs,
//     and the sixteen stateless helpers (editor-architecture §21's accounting of the 46 files)
//   - the FACADE may import every seam module, because assembling them is what it is
//   - a seam module may import another seam module's TYPES. `import type` is erased, so it
//     carries no runtime edge and cannot become an unassembled call. This is the same
//     exemption `frontend-no-engine-leakage.test.ts` grants for the same reason, and the
//     opposite of `no-chrome-leakage.test.ts`'s stance — the two files differ because their
//     SUBJECTS do (what reaches a bundle vs which layer a module belongs to). This file's
//     subject is a runtime call graph, so erasure settles it.
//
// WHAT IS NOT COVERED, named rather than implied: `await import(…)` and `require(…)`, on the
// sibling guards' own reasoning — matching a quoted specifier with no import keyword in front
// of it would fire on the prose in these files, and a guard that cries wolf gets weakened.
const FIELD_HOST = join(import.meta.dir, "..", "src", "field-host");

/** The facade. Not a seam module by the classifier below — it exports no `*Deps`, because
 *  nothing assembles IT from inside this directory. */
const FACADE = "field-host.ts";

/** The barrel. The one file that may value-import the facade: publishing `createFieldHost`
 *  to the chrome is its entire job. */
const BARREL = "index.ts";

const source = (name: string): string =>
  readFileSync(join(FIELD_HOST, name), "utf8");

const names = (): string[] =>
  walk(FIELD_HOST)
    .map((f) => relative(FIELD_HOST, f))
    .sort();

/** WHAT MAKES A MODULE A SEAM, computed rather than listed. A hardcoded roster is the exact
 *  thing that rots here — twenty-one modules arrived over six tranches and the twenty-second
 *  would simply not be in the list, so the check would pass while the boundary it names went
 *  unwatched.
 *
 *  The property: the module declares its own `*Deps` record. That is not a proxy for
 *  "extracted cluster", it IS the shape — a module assembled by the facade with an explicit
 *  dependency record is what every one of T3's extractions produced, and what the three T4c
 *  modules written from scratch (`field-capture.ts`, `field-mutation.ts`, `field-query.ts`)
 *  adopted unchanged. It reproduces `docs/reference/editor-architecture.md` §21's roster
 *  exactly — that table names 21 modules, and so does this predicate.
 *
 *  Anchored at column 0 so a `//`-commented mention cannot match, which is the discipline
 *  `register-first.test.ts`'s header documents at length after its own first version was
 *  defeated by ordinary authoring. */
const SEAM_DECL = /^export (?:type|interface) \w*Deps\b/m;

const seamModules = (): string[] =>
  names().filter((n) => SEAM_DECL.test(source(n)));

/** Every intra-directory import statement, as `[clause, specifier]`.
 *
 *  `[^;]*?` rather than `[\s\S]*?` between the keyword and `from` is load-bearing: a
 *  side-effect import (`import "./x.ts";`) has no `from` of its own, and a pattern that can
 *  cross a `;` would happily pair that keyword with the NEXT statement's specifier and
 *  attribute the wrong names to the wrong edge. An import clause cannot contain a semicolon,
 *  so the class is a correct fence.
 *
 *  Column-0 anchored, for `SEAM_DECL`'s reason. These files carry more prose than code — the
 *  map measures `field-host.ts` at 76.6% comment — and every one of them discusses its
 *  neighbours by name. */
const IMPORTS = /^(?:import|export)\s+([^;]*?)from\s+"\.\/([^"]+)";/gm;

type Edge = { from: string; to: string; values: string[] };

/** The VALUE names an import statement brings in — `[]` when the statement is erased.
 *
 *  Two erasure forms, both of which appear in this directory: the statement-level
 *  `import type { A, B } from …`, and the per-specifier `import { type A, b } from …`
 *  (`field-capture.ts` and `field-host.ts` both write the mixed form). A default or namespace
 *  clause with no braces is always a value, and is reported under its own text. */
const valueNames = (clause: string): string[] => {
  const trimmed = clause.trim();
  if (/^type\b/.test(trimmed)) return [];
  const braced = trimmed.match(/\{([^}]*)\}/);
  if (braced === null) return [trimmed];
  return (braced[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^type\b/.test(s));
};

const edgesFrom = (name: string): Edge[] =>
  [...source(name).matchAll(IMPORTS)].map((m) => ({
    from: name,
    to: m[2] ?? "",
    values: valueNames(m[1] ?? ""),
  }));

/** Named, not counted. The fix for a violation is a line in a `*Deps` record and a line at
 *  the assembly site, and neither is findable from a bare `false`. Both ends and the
 *  offending bindings go in the message. */
const render = (e: Edge): string =>
  `${e.from} → ${e.to} { ${e.values.join(", ")} }`;

test("the seam roster is derived from the source, not from a list in this file", () => {
  const seams = seamModules();
  // A scan that classifies nothing passes vacuously, and for a predicate over a regex that is
  // the likeliest way it stops meaning anything (a renamed convention, a formatter wrapping
  // the declaration). The floor is well below the 21 measured at head so an extraction does
  // not have to come back here, and well above zero so a broken predicate cannot hide.
  expect(seams.length).toBeGreaterThan(15);
  // The facade is not one of them, which is what makes "the facade may import seams" a
  // direction rather than a tautology.
  expect(seams).not.toContain(FACADE);
});

test("the facade assembles every seam module, and nothing else assembles any", () => {
  const seams = new Set(seamModules());
  /** A `create*` binding taken from a module that declares a `*Deps` record — i.e. someone
   *  constructing a cluster. `field-flags.ts`'s `createFlagStore` and `input-router.ts`'s
   *  `createRung` are NOT this: neither module declares a deps record, both are shared
   *  primitives, and the modules that build them are doing their own bookkeeping rather than
   *  standing up a peer. The predicate reads the TARGET, not the name. */
  const assemblies = (name: string): Edge[] =>
    edgesFrom(name)
      .filter((e) => seams.has(e.to))
      .map((e) => ({
        ...e,
        values: e.values.filter((v) => v.startsWith("create")),
      }))
      .filter((e) => e.values.length > 0);

  // BOTH HALVES, because they catch opposite failures: a module that arrives without being
  // assembled (coverage), and a module that assembles a peer (trespass). Neither catches a
  // BROKEN CLASSIFIER — probed, and stated because the first draft of this comment claimed
  // otherwise: empty the `SEAM_DECL` match and both halves here pass over an empty set, in
  // silence. The floor in the test above is the only thing that reddens, which is what that
  // floor is for and why it is not decoration.
  const assembled = new Set(assemblies(FACADE).map((e) => e.to));
  expect([...seams].filter((s) => !assembled.has(s))).toEqual([]);

  const trespassers = names()
    .filter((n) => n !== FACADE)
    .flatMap(assemblies)
    .map(render);
  expect(trespassers).toEqual([]);
});

/** The seam-to-seam VALUE edges that stand at head — a MEASURED RESIDUAL, not a licence.
 *
 *  Asserted as an exact set on `no-chrome-leakage.test.ts`'s precedent ("the edge is permitted
 *  for exactly one module and forbidden for the rest, and a boolean cannot say that"), so a
 *  second one is a deliberate edit to this line rather than a silent arrival.
 *
 *  WHAT THE ONE IS. `EDITOR_PROJECTION` is a frozen `as const` record of three numbers
 *  (`fovYRad`, `near`, `far`), exported at T4c so `field-capture.ts`'s off-screen camera can
 *  be the viewport's — "a capture with its own near plane would clip geometry the human can
 *  see", at that declaration. It is not state and it is not a verb, so it does not travel
 *  through a deps record and nothing about it is unassembled: `field-capture.ts` takes
 *  `field-render.ts`'s `compose` the correct way, as a dep, and its `FrameComposition` import
 *  is type-only.
 *
 *  IT IS ALSO NOT SETTLED. `field-host-clusters.md` §2.10 met this exact shape from the other
 *  side — three accent constants kept in `field-host.ts` specifically so that "two sibling
 *  modules value-import a third for a literal" would not happen — and left choosing an owner
 *  among peers to the prune tranche
 *  (`docs/backlog/editor-and-tooling/field-host-prune-tranche.md`). This row is that
 *  deferral's one live instance. Resolving it means moving the record to a shared point, not
 *  weakening this line.
 *
 *  Regenerate, from `packages/editor`:
 *
 *    bun -e 'const {readdirSync,readFileSync}=require("node:fs");
 *      const D="src/field-host", f=readdirSync(D).filter(n=>n.endsWith(".ts"));
 *      const S=new Set(f.filter(n=>/^export (?:type|interface) \w*Deps\b/m.test(readFileSync(`${D}/${n}`,"utf8"))));
 *      for (const n of [...S].sort()) for (const m of readFileSync(`${D}/${n}`,"utf8")
 *        .matchAll(/^(?:import|export)\s+([^;]*?)from\s+"\.\/([^"]+)";/gm))
 *        if (S.has(m[2]) && !/^type\b/.test(m[1].trim())) console.log(n, "→", m[2], m[1]);' */
const STANDING_VALUE_EDGES = [
  "field-capture.ts → field-camera-rig.ts { EDITOR_PROJECTION }",
];

test("no seam module reaches a peer at runtime — every module→module edge is assembled", () => {
  const seams = seamModules();
  const crossings = seams
    .flatMap(edgesFrom)
    .filter((e) => seams.includes(e.to) && e.values.length > 0)
    .map(render)
    .sort();
  expect(crossings).toEqual(STANDING_VALUE_EDGES);
});

test("nothing under field-host/ value-imports the facade — the arrow runs one way", () => {
  // The direction half of the allowed-edge statement. The facade imports twenty-one modules;
  // a value import back would close a cycle, and the only reason none exists today is that
  // every module takes the facade's TYPES and nothing else (`ViewportGesture`,
  // `FieldLayers`, `SelectionInfo` — the vocabulary the seam is written in, all erased).
  //
  // `index.ts` is the exception and is the whole of it: re-exporting `createFieldHost` is
  // what a barrel is for.
  const offenders = names()
    .filter((n) => n !== FACADE && n !== BARREL)
    .flatMap(edgesFrom)
    .filter((e) => e.to === FACADE && e.values.length > 0)
    .map(render);
  expect(offenders).toEqual([]);
});
