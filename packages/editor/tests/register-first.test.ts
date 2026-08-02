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

/** A file only needs the DOM if it pulls in the render harness. This is what lets the five
 *  pure-logic inspector tests (`format`, `scrub`, `numeric-schema`, `echo-guard`, `vec-fan`)
 *  out of the rule rather than injecting happy-dom's globals into suites that never render —
 *  scoping registration to the files that need it is `_register.ts`'s own stated contract. */
const HARNESS = /^import .*"\.(?:\.\/inspector)?\/_harness\.tsx";$/m;

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

// The chrome rule is UNCONDITIONAL — every file in the directory, harness or not. It is the
// stricter of the two deliberately: `keybindings-dom.test.ts` imports `_register.ts` alone and
// no harness, so dropping chrome to the `inspector/` predicate to share one rule would quietly
// stop covering it.
test("every chrome test registers happy-dom before its first import", () => {
  // A scan that finds nothing passes vacuously, which for a directory-wide claim is the most
  // likely way for it to stop meaning anything (a moved directory, a renamed suffix).
  expect(testsIn("chrome").length).toBeGreaterThan(10);
  expect(offendersIn("chrome", () => true)).toEqual([]);
});

test("every rendering inspector test registers happy-dom before its first import", () => {
  const files = testsIn("inspector");
  expect(files.length).toBeGreaterThan(10);
  // The guard that keeps the PREDICATE honest, not just the directory: respell the harness
  // import and every file silently stops needing registration, leaving this test to pass on
  // an empty set. Eleven of sixteen render today.
  const rendering = files.filter((f) =>
    HARNESS.test(readFileSync(join(TESTS, "inspector", f), "utf8")),
  );
  expect(rendering.length).toBeGreaterThan(5);
  expect(offendersIn("inspector", (src) => HARNESS.test(src))).toEqual([]);
});
