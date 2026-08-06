import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The mirror of `frontend-no-engine-leakage.test.ts`. That one keeps the ENGINE out of the
// chrome; this one keeps the CHROME out of the two layers underneath it. Both halves of the
// editor's `frontend/ → field-host/ → shared/` arrow (editor-architecture §7) are now
// machine-enforced, in both directions, and neither half is prose any more.
//
// WHY ONE TEST FOR TWO DIRECTORIES: they are the same rule read at two depths. React is what
// the chrome is MADE of, so "carries no React" is the operational spelling of "sits below the
// chrome" — and it has to hold for `field-host/` and for `shared/` alike, since the chrome
// imports both. Splitting it across two files would make one rule look like two.
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
const FIELD_HOST = join(import.meta.dir, "..", "src", "field-host");
const SHARED = join(import.meta.dir, "..", "src", "shared");

// Both spellings of the module specifier, and BOTH import kinds. A type-only React import
// would be erased from the bundle, so this is stricter than the engine guard (which exempts
// `import type` because erasure is exactly what makes it safe) — the rule here is about
// which layer a module belongs to, not about what reaches a bundle, and a layer that names
// React's types is a layer that knows about React.
const REACT = /from\s+["']react(-dom)?(\/[^"']*)?["']/m;
// Any specifier reaching into the chrome. `field-host/` is a direct child of `src/`, so the
// chrome is `../frontend/…` from every file in it; the pattern is written wider than that
// on purpose, so it survives a subdirectory being added here.
const CHROME = /from\s+["'][^"']*\/frontend\/[^"']*["']/m;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

const offenders = (dir: string, rule: RegExp): string[] =>
  walk(dir).filter((f) => rule.test(readFileSync(f, "utf8")));

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
