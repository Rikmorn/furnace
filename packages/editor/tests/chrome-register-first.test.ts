import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// EVERY chrome test registers happy-dom BEFORE its first real import, and this is the scan
// that keeps that true. A pure `node:fs` read — no DOM, no render — which is why it lives at
// `tests/` root rather than in `chrome/`.
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
// mechanism, misread as a quirk of one file. The same mechanism is why
// `segmented-field.test.tsx` + `shell.test.tsx` could not share a batch.
//
// It has also been WRONG IN PROSE twice in two commits: a comment claiming "every chrome
// test carries it" shipped in the same commit as one counting 13 of 16. A statement nothing
// checks is a statement that drifts, so this file checks it. A new chrome test written
// without the import re-poisons the directory and costs the suite 5× — here that is one
// legible failure naming the file and the line to add.
const CHROME = join(import.meta.dir, "chrome");

/** The one spelling that survives. A BARE side-effect import: `organizeImports` sorts a
 *  named `./_harness.tsx` import below `../../src/…` and would revert any attempt to hoist
 *  it, while a side-effect import keeps the position it was written in.
 *
 *  Anchored to a WHOLE LINE (`^…$`, multiline), which is load-bearing rather than tidy. A
 *  plain substring search matches the text inside `// import "../inspector/_register.ts";`
 *  — and commenting the line out to isolate a failing test is the likeliest way it ever
 *  disappears. That spelling passed the first version of this scan while leaving the file
 *  with no registration at all, which is precisely the landmine here to be caught. */
const REGISTER = /^import "\.\.\/inspector\/_register\.ts";$/m;

const chromeTests = (): string[] =>
  readdirSync(CHROME)
    .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
    .sort();

test("every chrome test registers happy-dom before its first import", () => {
  const files = chromeTests();
  // A scan that finds nothing passes vacuously, which for a directory-wide claim is the
  // most likely way for it to stop meaning anything (a moved directory, a renamed suffix).
  expect(files.length).toBeGreaterThan(10);

  const offenders = files.filter((name) => {
    const src = readFileSync(join(CHROME, name), "utf8");
    const register = src.search(REGISTER);
    if (register === -1) return true;
    // Position, not just presence: the import has to come before the first OTHER import,
    // because what matters is that registration runs before any DOM-touching module in
    // this file's graph is evaluated.
    const firstImport = src.search(/^import /m);
    return firstImport !== -1 && firstImport < register;
  });

  // Named rather than counted: the failure has to say which file to edit, since the fix is
  // one line and the symptom is 130 unrelated tests in a different file.
  expect(offenders).toEqual([]);
});
