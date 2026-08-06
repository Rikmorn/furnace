import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The mirror of `frontend-no-engine-leakage.test.ts`. That one keeps the ENGINE out of the
// chrome; this one keeps the CHROME out of every layer underneath it. Both halves of the
// editor's `frontend/ → { field-host/, action-registry/ } → shared/` arrow
// (editor-architecture §7) are machine-enforced, in both directions, and neither half is
// prose any more.
//
// WHY ONE TEST FOR THREE DIRECTORIES: they are the same rule read at three depths. React is
// what the chrome is MADE of, so "carries no React" is the operational spelling of "sits
// below the chrome" — and it has to hold for `field-host/`, `shared/` and (since T3b2)
// `action-registry/` alike, since the chrome imports all three. Splitting it across three
// files would make one rule look like three.
//
// WHERE EACH RULE CAME FROM:
//   - `field-host/` imports no React — foundations T3b1 Task 6, which moved eight modules so
//     the import arrow ran one way, and left the host with zero React imports. This holds
//     that zero.
//   - `field-host/` imports nothing out of `frontend/` — the same task, the same arrow, read
//     as a direction rather than as a dependency. Seven host files used to reach up into
//     `frontend/lib/`; the modules moved rather than the rule bending, and nothing may
//     reach back up.
//   - `shared/` imports no React — T3b1 Task 6 declared `shared/` "React-free and
//     engine-free". The engine-free half became a fact the same day: the leakage guard
//     scans `src/shared/` with no exemptions. The React-free half stayed prose, and Task 6's
//     review flagged that asymmetry. This closes it.
//   - `shared/` imports nothing out of `frontend/` — the same arrow again, at the bottom
//     of it. `shared/` is under BOTH layers, so the direction rule that binds the host
//     binds the floor twice over. Task 8's review proved this one was guarded by nothing:
//     see the measurement note below.
//
// §7 states `shared/`'s arrow more widely still — it imports nothing ABOVE it. It used to
// import nothing AT ALL (two type-only `@furnace/core/field` lines and no more), and that
// stopped being true in foundations T3b2: `action-table.ts` value-imports `field-brush.ts`
// and `field-limits.ts`, both siblings. Asserting the older, wider reading literally means
// forbidding any `../` specifier — which would have failed on those two the day they
// landed. The wider rule is deliberately not what this file pins, and three measurements
// (taken before T3b2, when the wider reading was still true) decided it:
//   - `shared/ → frontend/` was guarded by nothing at all. Planting a real value import of
//     `../frontend/lib/notify-store.ts` into `field-brush.ts` left all five tests across
//     both guard files green. That is the hole, and the `CHROME` rule below closes it.
//   - `shared/ → field-host/` is ALREADY guarded where it can do harm: the same plant with
//     a `../field-host/…` value import fails the engine guard's `shared/` scan, because a
//     `field-host` specifier is one of the three things that scan forbids. Only the
//     type-only form escapes, and that one is erased.
//   - A blanket `../` rule false-positives the day `shared/` grows a subdirectory: a file
//     at `shared/sub/x.ts` importing `../field-brush.ts` — a legitimate intra-layer
//     import — trips it. Verified, not assumed. A guard that cries wolf gets weakened.
//     T3b2 collected on this one sooner than a subdirectory would have: `./field-brush.ts`
//     from a sibling is the same legitimate import with a shorter specifier.
// So the wider rule's only real gain over what is now enforced is an erased type-only
// import, bought at the price of a false positive on a plausible refactor. `CHROME` is
// written to survive that refactor instead.
//
// `action-registry/` (foundations T3b2 Task 3) is the third scanned directory and the
// newest layer node: the editor's 39 verbs as ROWS, so a process with no DOM can hold the
// table. It sits BESIDE `field-host/` under the chrome — it may value-import
// `@furnace/core` and `shared/`, and it may import React, `field-host/` or `frontend/` not
// at all. The first two rules below are the host's, read at the new node; the third
// (`field-host/`) is this file's first, and it exists because the two nodes are SIBLINGS
// rather than a chain: nothing else would stop the registry reaching sideways into the
// engine-facing half and taking a `FieldHost` type — or a value — with it.
//
// The DOM half of the rule is NOT a regex and could not usefully be one: a
// `KeyboardEvent` named in a type position is erased, and the identifiers that matter
// (`window`, `document`) are ordinary English words in a file this dense with prose. It is
// held by `tests/action-registry/node-door.test.ts` instead, which imports the module in a
// bare runtime and is the reason `matchBinding` takes FACTS rather than an event.
//
// The fourth rule of the set is not here: "the chrome may reach the registry TYPE-ONLY"
// lives in `frontend-no-engine-leakage.test.ts`, beside the rules it is a member of. Its
// reason is that file's reason — a chrome VALUE-import of the registry would pull zod, and
// eventually `@furnace/core`, into the chrome bundle — and it is enforced by that file's
// `valueImportRules` machinery, which already knows that `import type` is erased. Splitting
// it by mechanism rather than by subject keeps each file's rules provable the same way.
const FIELD_HOST = join(import.meta.dir, "..", "src", "field-host");
const SHARED = join(import.meta.dir, "..", "src", "shared");
const ACTION_REGISTRY = join(import.meta.dir, "..", "src", "action-registry");

// TWO IMPORT FORMS PER RULE, not one. Each pattern below is a bare SPECIFIER body, and
// `bans` wraps it in both spellings that bring a module in:
//
//   import … from "react"    the `from` form
//   import "react"           the SIDE-EFFECT form, which has no `from` at all
//
// The second was missing until foundations T3b2's review executed the rules rather than
// reading them: `import "react";` matched nothing here, which is the deeper reason the
// plan's `import "react"` sabotage for this file would have proved nothing. The sibling
// engine guard has carried a side-effect rule all along, so this was an asymmetry between
// two files that are meant to be mirrors.
//
// `await import(…)` and `require(…)` are still uncovered, and that is a deliberate stop
// rather than an oversight: catching them means matching a quoted specifier with no import
// keyword in front of it, and these files are dense enough with prose naming their own
// neighbours that such a rule would fire on comments. A guard that cries wolf gets weakened.
// The Node door is what covers the runtime graph; these rules cover the static one.
//
// BOTH IMPORT KINDS, too — `import type` counts here. A type-only React import is erased
// from the bundle, so this is stricter than the engine guard (which exempts `import type`
// because erasure is exactly what makes it safe): the rule here is about which layer a
// module belongs to, not about what reaches a bundle, and a layer that names React's types
// is a layer that knows about React.
const bans = (specifier: string): RegExp[] => [
  new RegExp(String.raw`from\s+${specifier}`, "m"),
  new RegExp(String.raw`^\s*import\s+${specifier}`, "m"),
];

// Both spellings of the React package.
const REACT = bans(String.raw`["']react(-dom)?(\/[^"']*)?["']`);
// Any specifier reaching into the chrome. `field-host/` is a direct child of `src/`, so the
// chrome is `../frontend/…` from every file in it; the pattern is written wider than that
// on purpose, so it survives a subdirectory being added here.
const CHROME = bans(String.raw`["'][^"']*\/frontend\/[^"']*["']`);
// Any specifier reaching into the engine-facing host — a relative path into the directory
// (`../field-host/index.ts`) or the package export (`"@furnace/editor/field-host"`). The
// segment-ending anchor is the engine guard's, kept identical on purpose: an unanchored
// rule flags `frontend/lib/field-host-mirrors.ts`, a chrome-internal helper that shares the
// prefix and nothing else. Only `action-registry/` is scanned with this, since `shared/`
// sits below the host and `field-host/` is the host.
const HOST = bans(String.raw`["'][^"']*field-host(\/|["'])`);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

const offenders = (dir: string, rules: RegExp[]): string[] =>
  walk(dir).filter((f) => {
    const text = readFileSync(f, "utf8");
    return rules.some((re) => re.test(text));
  });

test("field-host/ imports no React — the host layer sits below the chrome", () => {
  expect(offenders(FIELD_HOST, REACT)).toEqual([]);
});

test("field-host/ imports nothing out of frontend/ — the arrow runs one way", () => {
  expect(offenders(FIELD_HOST, CHROME)).toEqual([]);
});

test("shared/ imports no React — the neutral floor stays neutral", () => {
  expect(offenders(SHARED, REACT)).toEqual([]);
});

test("shared/ imports nothing out of frontend/ — the neutral floor is under both", () => {
  expect(offenders(SHARED, CHROME)).toEqual([]);
});

test("action-registry/ imports no React — the table is rows, not components", () => {
  expect(offenders(ACTION_REGISTRY, REACT)).toEqual([]);
});

test("action-registry/ imports nothing out of frontend/ — the arrow runs one way", () => {
  expect(offenders(ACTION_REGISTRY, CHROME)).toEqual([]);
});

test("action-registry/ imports nothing out of field-host/ — the two are siblings", () => {
  expect(offenders(ACTION_REGISTRY, HOST)).toEqual([]);
});
