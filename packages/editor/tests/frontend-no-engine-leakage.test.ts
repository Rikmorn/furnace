import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FRONTEND = join(import.meta.dir, "..", "src", "frontend");

// Value-level references to engine code in the chrome would create a SECOND core
// instance next to the engine bundle's — the exact bug the project-first
// invariant exists to prevent. `import type` / `export type` are fine (erased).
const ENGINE = String.raw`["']@furnace\/core`;
// field-protocol value-imports @furnace/core/field, so it CARRIES core. A
// relative value-import of it (specifier not matched by the @furnace/core rule)
// into a chrome-graph file would pull core into the main bundle just as surely —
// so it is forbidden from non-exempt files too. Any specifier ending in
// `field-protocol` (`./field-protocol.ts`, `./lib/field-protocol.ts`).
const PROTOCOL = String.raw`["'][^"']*field-protocol`;
// viewport-host/index.ts is the ENGINE BARREL — it value-imports @furnace/core/*
// (it re-exports the hosts). A value-import of it into any chrome file would
// transitively pull core into the main bundle just as surely as an @furnace/core
// import, and — before this rule — no test would fail: the two rules above match
// only `@furnace/core` and `field-protocol` specifiers, not `viewport-host`. The
// invariant held solely by manual discipline (every chrome import of the barrel is
// kept `import type`). Machine-enforce it. Any specifier ending in `viewport-host`
// (`../../viewport-host/index.ts`, `./viewport-host`).
const VIEWPORT_HOST = String.raw`["'][^"']*viewport-host`;

// All three rule-sets (@furnace/core, field-protocol, viewport-host) exempt the
// SAME files: the dedicated field remesh worker is its OWN bundle (/field-worker.js),
// spawned by URL into an isolated Worker realm that NEVER loads /engine.js. It has no
// extension surface, so it consumes stock engine mesher code (@furnace/core/field)
// directly. The hazard this invariant guards — a duplicate core instance next to the
// engine bundle in the SAME realm — cannot arise there: that realm has no engine bundle
// at all. Exempt files may (1) value-import @furnace/core AND (2) value-import the
// core-carrying field-protocol module — they ARE that bundle (field-worker.ts
// value-imports createFieldWorkerHandler; field-protocol.ts value-imports the mesher).
// The viewport-host rule is a no-op for them: the worker files don't import the barrel
// at all, so exempting them changes nothing while the rule catches any CHROME file that
// value-imports it. Every non-exempt chrome file may do NONE of the three: it may import
// @furnace/core, field-protocol, AND viewport-host only TYPE-ONLY (erased). The
// main-thread field client (field-client.ts) imports the protocol TYPE-ONLY, and the
// hosts (FieldHost/PreviewHost/ViewportHost) reach the chrome ONLY via the /engine.js
// runtime channel — never a static value import — which the viewport-host rule now
// machine-enforces; without it core could re-enter the chrome via the barrel with no
// test failing.
const ENGINE_DIRECT_WORKER = new Set([
  "field-worker.ts",
  join("lib", "field-protocol.ts"),
]);

/** The three ways a value dependency (non-erased) enters a module's bundle, for
 *  a given quoted-specifier pattern. `import type` / `export type` are erased,
 *  so the value-import / re-export rules exclude them via the `type` lookahead. */
const valueImportRules = (specifier: string): RegExp[] => [
  new RegExp(String.raw`^import\s+(?!type\b)[^;]*?from\s+${specifier}`, "m"), // value import
  new RegExp(String.raw`^import\s+${specifier}`, "m"), // side-effect import
  new RegExp(String.raw`^export\s+(?!type\b)[^;]*?from\s+${specifier}`, "m"), // value re-export
];

const FORBIDDEN = [
  ...valueImportRules(ENGINE),
  ...valueImportRules(PROTOCOL),
  ...valueImportRules(VIEWPORT_HOST),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

test("frontend has no value imports of @furnace/core (project-first invariant)", () => {
  const offenders = walk(FRONTEND).filter((f) => {
    if (ENGINE_DIRECT_WORKER.has(relative(FRONTEND, f))) return false;
    const text = readFileSync(f, "utf8");
    return FORBIDDEN.some((re) => re.test(text));
  });
  expect(offenders).toEqual([]);
});
