// The walk every SOURCE-SCAN guard in this package shares, in a NON-test module so the three
// suites that need it can hold one copy without importing each other's `test()` calls — the
// `_actions-fixture.ts` / `chrome/_stub-host.ts` / `inspector/_harness.tsx` convention.
//
// THREE is what earned the extraction, and not one before it: `frontend-no-engine-leakage.ts`
// and `no-chrome-leakage.ts` carried this function character for character, and foundations
// T4a's single-funnel guard would have made it three (`clean-code.md`: tolerate duplication
// until the third occurrence, then extract). What it must NOT become is a home for the RULES —
// each of those files owns a different question (what may the chrome import; what may sit
// below it; who may call `member.arm`), and the arguments for them are long, specific and
// belong beside the assertion they license. This module holds the traversal and nothing else.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every `.ts`/`.tsx` file under `dir`, recursively, as absolute paths.
 *
 *  UNSORTED, deliberately: `readdirSync` order is the platform's, so a caller comparing the
 *  result against a literal list sorts at its own call site — which is what two of the three
 *  do (`actions.test.ts`'s single-funnel guard, and `frontend-no-engine-leakage.test.ts`'s
 *  own anti-vacuity check on what it scanned). Sorting here would make that look like a
 *  property of the walk rather than of the assertion, and a caller that only filters —
 *  `no-chrome-leakage.test.ts`, whose every case ends `toEqual([])` — pays nothing for an
 *  order it never reads.
 *
 *  No exclusions of its own. A directory this should skip does not exist yet in `src/`, and a
 *  skip list here would be a silent one — every caller's scan would quietly stop covering
 *  something with no case naming it. */
export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}
