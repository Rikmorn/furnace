import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FRONTEND = join(import.meta.dir, "..", "src", "frontend");
// `src/shared/` is the neutral layer both arrows point at (`frontend/ → field-host/ →
// shared/`, editor-architecture §7). It is scanned by the SAME rules and with NO
// exemptions, and that is not decoration: FOUR of its five modules (`catalog.ts`,
// `field-brush.ts`, `field-entity.ts` and — since T3b2 — `field-limits.ts`) are
// VALUE-imported by chrome components, so a core value-import added to one of them lands in
// the main bundle exactly like a direct one — and the chrome's own import
// (`../../shared/catalog.ts`) matches none of the three specifier rules below, so nothing
// else would catch it. (`action-table.ts` is the fifth and has no chrome consumer YET;
// T3b2 Task 5 gives it four, and the scan covers it either way — which is the point of
// scanning the DIRECTORY rather than a list.) This scan is what keeps the
// "engine-free" half of the `shared/` rule a fact rather than a comment. (Its React-free
// half is enforced by this file's mirror, `no-chrome-leakage.test.ts`, which keeps the
// chrome out of the layers below it the way this one keeps the engine out of the chrome.)
const SHARED = join(import.meta.dir, "..", "src", "shared");

// Value-level references to engine code in the chrome would create a SECOND core
// instance next to the engine bundle's — the exact bug the project-first
// invariant exists to prevent. `import type` / `export type` are fine (erased).
const ENGINE = String.raw`["']@furnace\/core`;
// The two worker protocols value-import @furnace/core/field, so they CARRY core.
// A relative value-import of one (specifier not matched by the @furnace/core
// rule) into a chrome-graph file would pull core into the main bundle just as
// surely — so they are forbidden from non-exempt files too. Any specifier ending
// in `field-protocol` or `analyzer-protocol` (`./field-protocol.ts`,
// `../field-host/analyzer-protocol.ts`).
const PROTOCOL = `["'][^"']*(field|analyzer)-protocol`;
// field-host/index.ts is the ENGINE BARREL — it value-imports @furnace/core/*
// (it re-exports the hosts). A value-import of it into any chrome file would
// transitively pull core into the main bundle just as surely as an @furnace/core
// import, and — before this rule — no test would fail: the two rules above match
// only `@furnace/core` and `field-protocol` specifiers, not `field-host`. The
// invariant held solely by manual discipline (every chrome import of the barrel is
// kept `import type`). Machine-enforce it.
//
// The trailing `(/|["'])` is a DIRECTORY BOUNDARY and it is load-bearing, which it was
// not under the directory's pre-T3b1 name: `field-host` is not a name only this directory
// wears. `frontend/lib/field-host-mirrors.ts` is a chrome-internal, engine-free helper,
// and an unanchored rule flags every chrome file that value-imports it — a false positive
// with no invariant behind it. The two ways a specifier can actually reach the host
// directory both end the segment: a path into it writes `field-host/`
// (`../../field-host/index.ts`, `../field-host/field-protocol.ts`), and the package export
// ends the specifier (`"@furnace/editor/field-host"`). Nothing reaches inside without one
// of those, so the boundary costs no coverage. Keep the anchor if the rule is ever
// re-spelled: any sibling file whose name STARTS with the directory's is a false positive.
//
// One clause keeps that claim exact: a bare directory specifier carrying a QUERY SUFFIX
// (`"../field-host?worker"`) ends the segment with neither a slash nor a quote, so the
// anchored rule misses it. Nothing writes that today, it does not resolve without a bundler
// plugin, and the useful form (`"../field-host/x.ts?worker"`) is still caught — so this is
// a documented edge, not a gap to widen the rule for. Widening it back to unanchored would
// re-break the mirrors file for a spelling nothing uses.
const FIELD_HOST = `["'][^"']*field-host(/|["'])`;
// `src/action-registry/schemas.ts` (foundations T3b2) is the ONE module under the registry
// that carries a zod VALUE — the input schemas, built from `@furnace/core/registry`'s `z`
// re-export for the single-instance contract. A chrome value-import of it would pull zod,
// and behind it core, into the main bundle: the same second instance the three rules above
// exist to prevent, arriving by a fourth door.
//
// NARROWED TO THAT MODULE IN TASK 4, from a rule over the whole directory, and the narrowing
// is what makes both halves of the constraint satisfiable at once. Chrome surfaces
// render `hint`, `keys` and `group` at RUNTIME, which needs a value import; the directory-
// wide rule barred it, and the plan's escape hatch — flow the data through
// `shared/action-table.ts` — is not available either, because the same rule is applied to the
// `shared/` walk and the floor sits BELOW the registry. So the layer split instead:
// `descriptors.ts`, `keys.ts`, `result.ts` and the barrel are plain, zod-free and
// chrome-value-importable, and every zod value lives in `schemas.ts`. What the guard checks
// is the constraint itself (no zod, no core, in the chrome bundle) rather than a proxy for it
// (editor-architecture §22.5, which recorded the decision in Task 3).
//
// THE BARREL IS COVERED BY CONSTRUCTION, not by a second pattern: `index.ts` re-exports the
// schema module's TYPES only, so there is no value edge for a chrome import of it to follow.
// A `export { ACTION_INPUT_SCHEMAS } from "./schemas.ts"` added there would defeat this rule
// silently — which is why that file says so in its header.
//
// NARROWING THE CHROME'S BAN OPENED A HOLE, AND THE THIRD SCAN BELOW CLOSES IT. The
// directory-wide rule made "no zod, no core, in the chrome bundle" structurally impossible to
// break: the chrome could not value-import ANY of it, so it did not matter which of those
// files carried an engine import. Narrowed to the schema module, it does matter — a value
// `import { z } from "@furnace/core/registry"` added to `descriptors.ts`, `keys.ts`,
// `result.ts` or the barrel would ride a legitimate chrome value-import straight into the
// main bundle, and no rule in either guard file would see it (`no-chrome-leakage.test.ts`
// scans this directory for React, `frontend/` and `field-host/` and nothing else). So the
// containment moved rather than being deleted: the four chrome-reachable modules are held to
// the SAME engine and zod rules the chrome is, and `schemas.ts` is the one file exempt from
// them — it is the module the licence was written for, and the chrome cannot reach it.
//
// It is enforced HERE rather than in `no-chrome-leakage.test.ts` (which owns the registry's
// other three rules) because the reason is this file's reason and the mechanism is this
// file's mechanism: `valueImportRules` already knows that `import type` / `export type` are
// erased and therefore fine, which is the whole shape of the permission.
//
// This rule binds `shared/` too, and correctly: the floor sits BELOW the registry, so a
// value-import there would point the arrow backwards as well as carry core.
const ACTION_SCHEMAS = `["'][^"']*action-registry/schemas`;
// zod's FRONT DOOR. `zod` is a direct dependency of this package (`package.json`) —
// legitimately, for the daemon, which validates every command with it. Nothing stops a
// chrome file writing `import { z } from "zod"` and putting the whole library in the main
// bundle: `ENGINE` matches `@furnace/core` and not its re-export's origin. The registry rule
// above closes the INDIRECT route (a chrome value-import of a schema-bearing module) and
// left this one open, which is half a rule. The constraint is that the chrome bundle gains
// neither zod NOR `@furnace/core`; this is the other half.
//
// Bare specifier only, anchored at both ends: `zod/v4` or a local `./zod-helpers.ts` are not
// this dependency and must not be swept up by a rule aimed at it.
const ZOD = `["']zod["']`;

// THE TWO WORKER ENTRIES ARE EXEMPT FROM THE ENGINE RULES ONLY — three of the five
// rule-sets below (@furnace/core, *-protocol, field-host), not all five. Each dedicated
// worker is its OWN bundle (/field-worker.js,
// /analyzer-worker.js), spawned by URL into an isolated Worker realm. They consume
// stock engine code (@furnace/core/field) directly. What must never happen is core
// entering the CHROME's bundle, which is what every rule below is about.
//
// Be precise about WHY each exemption is safe, because the two workers are safe for
// DIFFERENT reasons and only one of them is the easy case:
//   - The field worker's realm never loads /engine.js, so it holds exactly one core.
//   - The analyzer worker's realm holds TWO. Measured on the daemon-served bundle
//     (2026-07-26): /engine.js is ~8.7 MB, defines `createFieldStore` itself and has
//     ZERO external `@furnace/core` imports — esbuild INLINES core into it. So the
//     copy bundled into analyzer-worker.js (via analyzer-protocol.ts) sits beside the
//     engine bundle's own copy. The duplicate is real; do NOT cite this exemption as
//     evidence that a worker realm cannot have one.
// It is INERT here for two reasons, and both have to keep holding. (1) Everything
// crossing that seam is plain structural DATA — `FieldStore` is
// `{ cellSize, chunks: Map, materials: Map }` (core's types.ts), and `AgentProfile` /
// `FieldFlag` / `PlacementCollisionGroup` are likewise plain objects: no class
// identity, no `instanceof`, no symbols, so which core minted the value cannot matter
// (the dungeon's `AnalyzerVerifyOptions` says the same thing from its side —
// "Structural — an editor worker's mirror store satisfies it as readily as the game's
// own"). (2) The two instances share no module-level state: our copy runs only the
// pure column pass and the placement rasterizer, the bundle's copy owns the physics
// context and the collider derivation, and neither reads the other's registries.
// That is a claim about EXECUTION, not about bundle content: even when the physics
// module (Rapier's wasm-bindgen glue and all) ships inside a worker bundle, no code
// path in this realm calls it. The lever is one VALUE import, not the module graph of
// `@furnace/core/field` generally. Historically (measured 2026-07-26) that one import
// dragged the whole engine in: `packages/core/src/field/artifact.ts` imported
// `encodeMeshBlob` through core's since-deleted scene module, whose graph pulled
// gpu/mesh/material/physics/post behind it — a throwaway entry importing only
// `@furnace/core/field` bundled to 208 modules with `rapier` in it (~2.9 MB, against
// ~15 KB with scene marked external). Resolved 2026-08-04 (foundations T1a): the
// codec is its own engine-tier leaf module, `@furnace/core/mesh-blob`, and a
// field-only entry bundles no rapier at all. What still ships in these worker
// bundles is whatever the dungeon pass graph itself pulls; the exemption never
// depended on that being small. The cost is a second copy of core's JS in the
// worker's memory, which is accepted.
//
// Exempt files may (1) value-import @furnace/core AND (2) value-import a core-carrying
// protocol module — they ARE those bundles. The two worker ENTRIES are all that is left
// here: `field-worker.ts` value-imports `createFieldWorkerHandler` and `analyzer-worker.ts`
// value-imports `createAnalyzerWorkerHandler`, each now reaching across to
// `../field-host/`, and both of those protocol modules still value-import core
// themselves (the mesher; the advisor passes).
//
// WHAT THE EXEMPTION DOES NOT COVER, and the split below is what makes that machine-true
// rather than a sentence. Every word of the rationale above is about ENGINE code in a
// worker realm; none of it reaches the registry's schemas or `zod`, and a worker has no
// business with either (measured: the two entries import the two protocol modules and
// nothing else). When `action-registry` was added to a single flat `FORBIDDEN` list, the
// exemption widened over it silently — harmless, since neither entry imports it, but this
// file is the authority on its own rule set and an accidental licence is not one anybody
// granted. So the rules are two sets: EXEMPTABLE (the three engine rules, which the two
// entries may break) and UNIVERSAL (the schemas and zod, which nothing under `frontend/` may
// break). If a worker ever genuinely needs one of those, that is a conversation, not a
// default.
//
// THE PROTOCOL PAIR LEFT THIS SCAN, deliberately, and the coverage arithmetic is exactly
// zero (foundations T3b1): `field-protocol.ts` and `analyzer-protocol.ts` moved from
// `frontend/lib/` into `src/field-host/`, where they sit beside their main-thread
// clients. They were EXEMPT here — the walk skipped them whole — so a scan that never
// asserted anything about them loses nothing by no longer reaching them. What the move
// BUYS is a second rule over them: a chrome value-import of either now trips the
// field-host rule as well as the protocol rule.
//
// The field-host rule is a no-op for the two exempt entries in the other direction:
// they don't import the barrel (`field-host/index.ts`), only single modules inside that
// directory, and the specifier rule cannot tell those apart — hence they must be exempt
// from it too. Every non-exempt chrome file may do NONE of the three: it may import
// @furnace/core, the protocols, AND anything under field-host only TYPE-ONLY (erased).
// The main-thread clients (`field-host/field-client.ts`,
// `field-host/analyzer-client.ts`) import their protocol TYPE-ONLY, and the host
// (FieldHost) reaches the chrome ONLY via the /engine.js runtime channel — never a static
// value import — which the field-host rule machine-enforces; without it core could
// re-enter the chrome via the barrel with no test failing.
//
// Those two clients, and `field-size.ts` beside them, also left this scan in the same
// move, and that one IS a narrowing worth naming: they were non-exempt chrome files, so
// the walk really did assert they carried no core. It no longer needs to. They are HOST
// files now, where a core value-import is legitimate — and the invariant that mattered is
// enforced at the BOUNDARY instead: any chrome file value-importing one of them writes a
// specifier under `field-host`, which the third rule catches.
const ENGINE_DIRECT_WORKER = new Set(["field-worker.ts", "analyzer-worker.ts"]);

/** The registry's own directory, and the ONE file in it that may carry zod.
 *
 *  The exemption is a filename rather than a rule set because there is only one thing to
 *  say about it: `schemas.ts` holds the input schemas, it is licensed to value-import
 *  `@furnace/core/registry` for the single-instance contract, and the chrome may not
 *  value-import it. Every other file here is chrome-reachable and must therefore carry
 *  neither. */
const ACTION_REGISTRY = join(import.meta.dir, "..", "src", "action-registry");
const ZOD_LICENSED = new Set(["schemas.ts"]);

/** The three ways a value dependency (non-erased) enters a module's bundle, for
 *  a given quoted-specifier pattern. `import type` / `export type` are erased,
 *  so the value-import / re-export rules exclude them via the `type` lookahead. */
const valueImportRules = (specifier: string): RegExp[] => [
  new RegExp(String.raw`^import\s+(?!type\b)[^;]*?from\s+${specifier}`, "m"), // value import
  new RegExp(String.raw`^import\s+${specifier}`, "m"), // side-effect import
  new RegExp(String.raw`^export\s+(?!type\b)[^;]*?from\s+${specifier}`, "m"), // value re-export
];

/** The three ENGINE rules, which the two worker entries are exempt from — they are those
 *  bundles, and the long note above is the whole of why that is safe. */
const EXEMPTABLE = [
  ...valueImportRules(ENGINE),
  ...valueImportRules(PROTOCOL),
  ...valueImportRules(FIELD_HOST),
];

/** The two rules NOTHING under `frontend/` may break, worker entries included. Neither is an
 *  engine rule, so neither is covered by the engine exemption's reasoning. */
const UNIVERSAL = [
  ...valueImportRules(ACTION_SCHEMAS),
  ...valueImportRules(ZOD),
];

const FORBIDDEN = [...EXEMPTABLE, ...UNIVERSAL];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

test("frontend has no value imports of @furnace/core (project-first invariant)", () => {
  const offenders = walk(FRONTEND).filter((f) => {
    const text = readFileSync(f, "utf8");
    // The exemption is applied to the ENGINE rules only. A worker entry still may not
    // value-import the registry's schemas or zod — nothing in the exemption's rationale
    // reaches either, and a licence nobody granted is not a licence.
    const rules = ENGINE_DIRECT_WORKER.has(relative(FRONTEND, f))
      ? UNIVERSAL
      : FORBIDDEN;
    return rules.some((re) => re.test(text));
  });
  expect(offenders).toEqual([]);
});

test("action-registry/ carries no engine EXCEPT in schemas.ts — the chrome value-imports the rest", () => {
  // The other half of the narrowing above. These four files are the ones a chrome surface may
  // value-import at runtime (`ACTION_DESCRIPTORS`, `keycap`, `matchBinding`, `ACTION_OK`), so
  // an engine or zod import in any of them is a chrome-bundle import — held to the chrome's
  // own rules, in the file that owns those rules.
  const scanned = walk(ACTION_REGISTRY).filter(
    (f) => !ZOD_LICENSED.has(relative(ACTION_REGISTRY, f)),
  );
  // WHAT WAS SCANNED, asserted before what was found. `ZOD_LICENSED` is a silent skip path
  // and `toEqual([])` over an empty walk is a passing test that checked nothing — the
  // vacuity `descriptors.test.ts` guards against with its own count, and the shape this case
  // otherwise inherits from the `shared/` one below it. A file added here is a file this
  // list has to name.
  expect(scanned.map((f) => relative(ACTION_REGISTRY, f)).sort()).toEqual([
    "descriptors.ts",
    "index.ts",
    "keys.ts",
    "result.ts",
  ]);
  const offenders = scanned.filter((f) => {
    const text = readFileSync(f, "utf8");
    return [...valueImportRules(ENGINE), ...valueImportRules(ZOD)].some((re) =>
      re.test(text),
    );
  });
  expect(offenders).toEqual([]);
});

test("the chrome's action graph BUNDLES without zod — the constraint, not a proxy for it", async () => {
  // THE ONLY CHECK IN THIS FILE THAT READS THE THING THE RULES ARE ABOUT. Every rule above is
  // a specifier scan: a proxy, chosen because it is cheap and total over a directory. This
  // builds `frontend/lib/actions.ts` — the chrome module that value-imports the registry, and
  // therefore the door the narrowing above opened — and looks in the OUTPUT. A route the
  // regexes cannot see (a dynamic import, a re-export chain through a module nobody thought
  // to scan, a bundler resolving something unexpected) shows up here and nowhere else.
  //
  // Cheap enough to keep: 28 KB and ~16 ms at head.
  const built = await Bun.build({
    entrypoints: [join(FRONTEND, "lib", "actions.ts")],
    target: "browser",
  });
  if (!built.success)
    throw new Error(
      `the chrome's action graph did not build:\n${built.logs.join("\n")}`,
    );
  const out = built.outputs[0];
  if (out === undefined) throw new Error("the build produced no output");
  const code = await out.text();
  // A POSITIVE marker first, so a build that emitted nothing useful cannot pass by carrying
  // none of the forbidden names either.
  expect(code).toContain("view.snapNegZ");
  // Zod's runtime class names, which appear in no prose of ours — unlike the word "zod",
  // which several of these files spend paragraphs on. Searched in the built output, where
  // comments are already gone, but chosen so the case does not DEPEND on that.
  for (const marker of ["ZodObject", "$ZodType", "ZodString"])
    expect({ marker, present: code.includes(marker) }).toEqual({
      marker,
      present: false,
    });
});

test("shared/ carries no engine — the neutral layer stays neutral", () => {
  const offenders = walk(SHARED).filter((f) =>
    FORBIDDEN.some((re) => re.test(readFileSync(f, "utf8"))),
  );
  expect(offenders).toEqual([]);
});
