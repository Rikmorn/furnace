import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// EVERY test file that renders registers happy-dom BEFORE its first real import, and this is
// the scan that keeps that true. A pure `node:fs` read — no DOM, no render — which is why it
// lives at `tests/` root rather than inside either directory it covers.
//
// WHY IT EARNS ITS PLACE, since a scan over a coding convention usually does not. The rule
// is not style; it is load-bearing, process-wide, and it fails SILENTLY:
// `@radix-ui/react-use-layout-effect` resolves `globalThis?.document ? useLayoutEffect : noop`
// ONCE in its module body, and `@radix-ui/react-portal` mounts through
// `useLayoutEffect(() => setMounted(true), [])`. One file that reaches Radix before happy-dom
// exists pins that hook to the no-op branch for the WHOLE RUN, and every Radix portal in
// every other file then renders `null` under a trigger that opened perfectly well.
//
// The cost was measured at the F4.5c Task 12 review, and it was not small — stated as the
// RATIO and the wall clock, because the totals move every time anyone adds a case and a
// hardcoded pass count in a comment is the exact failure mode this file exists to stop:
//
//   bun test packages/editor/tests/chrome   →  ~130 failures, ~51s
//   …with the three missing imports added   →     0 failures, ~10s
//
// Three files (`confirm-dialog`, `flags-palette`, `host-seams-and-catalogs`) were missing it.
// That is the whole of the "never run the chrome directory, confirm-dialog poisons it"
// process fact that had been carried in briefs for the length of this slice — a real
// mechanism, misread as a quirk of one file.
//
// IT COVERS `inspector/` TOO, since F4.5c Task 15, and that directory is why this file's name
// no longer says "chrome". Nine inspector tests were missing the line, eight of them while
// stating in a header comment that they had it — the exact drift a scan exists to stop.
// A full-directory run did not care (85 pass / 0 fail / 180 asserts, either way), because
// bun happened to evaluate a DOM-safe file first, and one registration repairs
// the process for everybody loaded after it. That green was a property of the LOAD ORDER, not
// of the files, and the pair that exposes it costs one command:
//
//   bun test …/inspector/boolean-field.test.tsx …/inspector/enum-field.test.tsx
//     boolean-field WITHOUT the line  →  8 pass, 1 fail  (enum-field's trigger reads "")
//     boolean-field WITH the line     →  9 pass, 0 fail
//
// `boolean-field` reaches `@radix-ui/react-checkbox` above its harness import, and checkbox
// and select share ONE resolved copy of the shim (both land on
// `react-use-layout-effect@1.1.2`), so it poisons a portal it never renders. Note what does
// NOT save `enum-field` there: its own registration, which by then runs too late.
//
// This scan has also been WRONG IN PROSE twice in two commits: a comment claiming "every
// chrome test carries it" shipped in the same commit as one counting 13 of 16. A statement
// nothing checks is a statement that drifts, so this file checks it. A new test written
// without the import re-poisons its directory and costs the suite 5× — here that is one
// legible failure naming the file and the line to add.
//
// AND THE SCAN ITSELF HAS BEEN DEFEATED ONCE, which is the thing to read before trusting it:
// its first `HARNESS` predicate required a one-line import, so `bunx biome format --write`
// could silently exempt any file whose harness import grew past the line width. See that
// predicate's own docblock — a guard the repo's formatter can switch off reads as coverage
// while providing none, and that is the same disease as the files it polices.
const TESTS = import.meta.dir;

/** The one spelling that survives. A BARE side-effect import: `organizeImports` sorts a
 *  named `./_harness.tsx` import below `../../src/…` and would revert any attempt to hoist
 *  it, while a side-effect import keeps the position it was written in. The two alternatives
 *  are the two directories' relative paths to the same module.
 *
 *  Anchored to a WHOLE LINE (`^…$`, multiline), which is load-bearing rather than tidy. A
 *  plain substring search matches the text inside `// import "../inspector/_register.ts";`
 *  — and commenting the line out to isolate a failing test is the likeliest way it ever
 *  disappears. That spelling passed the first version of this scan while leaving the file
 *  with no registration at all, which is precisely the landmine here to be caught. */
const REGISTER = /^import "(?:\.\.\/inspector|\.)\/_register\.ts";$/m;

/** Does this file pull in the render harness? Matched on the line carrying the SPECIFIER,
 *  in both of the two shapes the repo's own formatter produces:
 *
 *      import { cleanup, render } from "./_harness.tsx";      ← under the line width
 *      } from "./_harness.tsx";                               ← Biome wrapped it
 *
 *  THE SECOND ALTERNATIVE IS THE WHOLE POINT, and it was added after a review defeated the
 *  first version of this scan using nothing but ordinary authoring. That version required the
 *  import on ONE line. Add two more real names to a harness import (`act` and `waitFor`, both
 *  genuine exports) and it crosses 80 characters; `bunx biome format --write` then wraps it,
 *  the predicate stops matching, and the file becomes SILENTLY EXEMPT — its register line can
 *  be deleted with this scan still green while it poisons every Radix portal in the run. Both
 *  directions were reproduced. The inspector harness imports sit at 68 characters today, so
 *  two more names is all it takes — and next door the wrapped form is already the MAJORITY:
 *  of the 17 chrome tests, 15 wrap, 1 is single-line (`material-swatches`) and 1 imports no
 *  harness at all (`keybindings-dom`).
 *
 *  A guard that the repo's own formatter can switch off is worse than no guard, because it
 *  reads as coverage. Anchored to column 0 on both alternatives so a `//`-commented mention
 *  cannot match — the same discipline `REGISTER` above documents.
 *
 *  WHAT THIS PREDICATE IS A PROXY FOR, stated precisely because the obvious reading is wrong.
 *  It is a proxy for "this file RENDERS", not for "this file reaches Radix". The harness does
 *  not itself reach Radix at runtime: its one path there is `editor-context.ts`'s
 *  `import type { ConfirmRequest }` from `ConfirmDialog.tsx`, which does value-import
 *  `ui/button.tsx` (→ `react-slot`) — but a type-only import is ERASED, so nothing on that
 *  path is ever evaluated. The harness's real runtime graph is four files and none is Radix.
 *  What makes importing it sufficient is simpler: the first import in `_harness.tsx` is a
 *  bare `import "./_register.ts";`, so pulling the harness in registers the DOM at all — the
 *  only open question is whether it happens FIRST.
 *
 *  So the exemption is sound and the residual hole is a different shape. The five pure-logic
 *  inspector tests (`format`, `scrub`, `numeric-schema`, `echo-guard`, `vec-fan`) render
 *  nothing AND reach no Radix — verified by a transitive trace that skips type-only imports —
 *  so leaving them alone is right, and injecting happy-dom's globals into suites that never
 *  render is what `_register.ts`'s own scoping note says not to do.
 *
 *  THE HOLE, named rather than closed: a file that imports a Radix-backed component WITHOUT
 *  the harness is exempt here and would still poison the run. No such file exists today, and
 *  a review built one to prove it (a probe importing `BooleanField` alone: scan green,
 *  `enum-field` red). Closing it means walking the module graph for `@radix-ui`, and getting
 *  that right needs the type-erasure subtlety above — a second delicate thing to maintain in
 *  a guard. If such a file is ever written, this is where it goes. */
const HARNESS =
  /^(?:import .*|\}) from "\.(?:\.\/inspector)?\/_harness\.tsx";$/m;

const testsIn = (dir: string): string[] =>
  readdirSync(join(TESTS, dir))
    .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
    .sort();

/** Named rather than counted: the failure has to say which file to edit, since the fix is one
 *  line and the symptom is 130 unrelated tests in a different file. */
const offendersIn = (
  dir: string,
  needsRegister: (src: string) => boolean,
): string[] =>
  testsIn(dir).filter((name) => {
    const src = readFileSync(join(TESTS, dir, name), "utf8");
    if (!needsRegister(src)) return false;
    const register = src.search(REGISTER);
    if (register === -1) return true;
    // Position, not just presence: the import has to come before the first OTHER import,
    // because what matters is that registration runs before any DOM-touching module in
    // this file's graph is evaluated.
    const firstImport = src.search(/^import /m);
    return firstImport !== -1 && firstImport < register;
  });

// The chrome rule is UNCONDITIONAL — every file in the directory, harness or not — and it is
// the stricter of the two deliberately. Measured against the CORRECTED `HARNESS` predicate:
// 16 of the 17 chrome tests match it, and the one that does not is `keybindings-dom.test.ts`,
// which imports `_register.ts` alone and no harness because it needs a real `HTMLElement` to
// narrow against and renders nothing. So collapsing the two rules into one predicate would
// quietly stop covering exactly one file — and that file is in this directory precisely
// because it is DOM-touching, which is the property the rule is about.
//
// Worth knowing how thin that argument was before the fix above: under the one-line-only
// predicate, 16 of 17 chrome files failed to match — every wrapped import — so "share one
// rule and we would lose `keybindings-dom`" was true by accident and understated the loss by
// sixteen times. The conclusion survived the correction; the reason did not, and a reason
// that only holds by accident is the same defect as a scan that only passes by accident.
test("every chrome test registers happy-dom before its first import", () => {
  // A scan that finds nothing passes vacuously, which for a directory-wide claim is the most
  // likely way for it to stop meaning anything (a moved directory, a renamed suffix).
  expect(testsIn("chrome").length).toBeGreaterThan(10);
  expect(offendersIn("chrome", () => true)).toEqual([]);
});

/** The inspector tests that are ALLOWED not to register: pure logic, no render, and — traced
 *  transitively with type-only imports skipped, because those are erased — no Radix anywhere
 *  in their runtime graph. An allowlist rather than a computed remainder, for the reason the
 *  next assertion states. */
const NON_RENDERING = [
  "echo-guard.test.ts",
  "format.test.ts",
  "numeric-schema.test.ts",
  "scrub.test.ts",
  "vec-fan.test.ts",
];

test("every rendering inspector test registers happy-dom before its first import", () => {
  const files = testsIn("inspector");
  expect(files.length).toBeGreaterThan(10);
  // THE GUARD THAT KEEPS THE PREDICATE HONEST, not just the directory: if `HARNESS` ever
  // stops matching, every file silently stops needing registration and the offender check
  // below passes on an empty set — which is precisely how the formatter defeated the first
  // version of this scan.
  //
  // Asserted as the EXEMPT SET BY NAME rather than as a floor on the rendering count. A
  // floor (`> 5`, when 11 of 16 render) degrades gradually: it absorbs five files dropping
  // out one at a time, which is exactly the shape a widening line-length problem has. Naming
  // the five makes any file leaving the rendering set a RED with the file in the message,
  // and makes adding a genuinely pure-logic test a deliberate edit here — which is the right
  // moment to re-check that it reaches no Radix.
  const exempt = files.filter(
    (f) => !HARNESS.test(readFileSync(join(TESTS, "inspector", f), "utf8")),
  );
  expect(exempt).toEqual(NON_RENDERING);
  expect(offendersIn("inspector", (src) => HARNESS.test(src))).toEqual([]);
});
