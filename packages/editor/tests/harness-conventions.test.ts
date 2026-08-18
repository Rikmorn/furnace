import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walk } from "./_source-scan.ts";

// TWO PROCESS-WIDE COSTS THIS PACKAGE'S TEST HARNESS PAYS BY DISCIPLINE, until now.
//
// Both come from one mechanism, which
// `docs/backlog/editor-and-tooling/bun-test-single-process-fragility.md` opens by stating: `bun test` runs every file the invocation covers in ONE shared process,
// with NO per-file isolation. A file cannot contain what it does to that process, so a rule
// about where a file sits or what it imports is not style — it is the only containment there
// is. That entry recorded both rules below as "convention, not enforced"; this file is what
// changes that, and the entry now says so. The MCP half is
// `docs/backlog/editor-and-tooling/mcp-sdk-construction-slows-the-process.md`; the gate the
// containment protects is `docs/reference/test-gate.md`.
//
// WHY A NEW FILE RATHER THAN THREE RULES IN `register-first.test.ts`, which is the package's
// other test-file-placement scan and the shape this one follows. Weighed both ways, and the
// split won on two counts. POLARITY: that scan asserts a line is PRESENT in two named
// subdirectories; these assert a thing is ABSENT, one of them across the whole tree — the
// same walk cannot serve both without an argument at every call site about which root and
// which direction. And SUBJECT: its header is one sustained argument about Radix's
// `useLayoutEffect` resolution and the two ways that scan has been defeated. Rule (b) below
// shares none of that — no DOM, no happy-dom, a dependency rather than a global — and a file
// named for one rule that quietly holds three is how a header stops being read. The
// counter-argument (both files are about test-file placement discipline, and a reader wants
// one place to look) is real, and is answered by each file naming the other.
const TESTS = import.meta.dir;

/** Every `.ts`/`.tsx` at the TOP LEVEL of `tests/`, without recursing. Rule (a) is a rule
 *  about this directory specifically — the subdirectories are where a DOM test is supposed to
 *  be — so the non-recursive listing IS the rule's subject rather than a shortcut. */
const bareTests = (): string[] =>
  readdirSync(TESTS)
    .filter((n) => n.endsWith(".ts") || n.endsWith(".tsx"))
    .sort();

const source = (name: string): string =>
  readFileSync(join(TESTS, name), "utf8");

// ---------------------------------------------------------------------------------------
// (a) happy-dom registers in a SUBDIRECTORY or not at all.
//
// `GlobalRegistrator.register()` copies every happy-dom `window` property whose value differs
// onto `globalThis` — `fetch` included, and happy-dom's `fetch` enforces the Same-Origin
// Policy. There is no unregister worth running (finding 3 in that entry: ~100 `delete
// globalThis[key]` calls, measured at ~3× wall clock for the rest of the process), so a
// registration that happens at the top level simply stands for the remainder of the run.
//
// THE MEASURED COST of one such file in bare `tests/`: 12 `server.test.ts` failures
// (`NetworkError: Cross-Origin Request Blocked`) plus 1 in `bundle-watch.test.ts`. And it does
// not stop at this package — the same registration flipped
// `packages/core/src/texture/load.gpu.test.ts`'s `typeof createImageBitmap === "function"`
// gate from false to true, admitting a case that then failed against happy-dom's own
// `ImageBitmap`. Any `typeof <web API> === "function"` skip gate anywhere in the workspace is
// a candidate once happy-dom is global.
//
// The convention works because of the WALK ORDER — a directory runs its own files before it
// recurses into subdirectories — so a DOM test under `tests/inspector/` or `tests/chrome/`
// lands after the top-level GPU and daemon suites. It is emphatically NOT alphabetical
// ordering; that claim was in the entry until 2026-08-04 and was wrong, and order *within* a
// directory is `readdir` order, unrelated to the file's name.

/** The two ways this package's tests reach happy-dom, and both are needed.
 *
 *  The PACKAGE, in either import form. The static form is how `tests/inspector/_register.ts`
 *  does it; the DYNAMIC form is how the one exempt file below does it, and matching it is what
 *  makes that exemption mean something rather than pass over an empty set.
 *
 *  The REGISTRATION MODULE, which is what every DOM test actually writes — a bare
 *  side-effect `import "../inspector/_register.ts";` above its first other import.
 *  `register-first.test.ts` owns the rule about that line's POSITION; this only asks whether
 *  the line is here at all, where it must not be.
 *
 *  Neither pattern can match a `//`-commented mention or a regex literal quoting one, because
 *  each requires a real `from "`, `import("` or column-0 `import "` immediately against the
 *  specifier. Probed rather than assumed: `register-first.test.ts` sits in this same directory
 *  and spends fifty lines quoting `import "../inspector/_register.ts";` in prose, and it is
 *  not an offender below. */
const REGISTERS_DOM: RegExp[] = [
  /from\s+"[^"]*@happy-dom\/global-registrator"/m,
  /import\s*\(\s*"[^"]*@happy-dom\/global-registrator"/m,
  /from\s+"[^"]*_register\.ts"/m,
  /^import "[^"]*_register\.ts";$/m,
];

/** The one top-level file that registers happy-dom on purpose, asserted BY NAME so a second
 *  one is a deliberate edit here rather than a silent arrival — `register-first.test.ts`'s
 *  `NON_RENDERING` precedent, and its argument: a floor degrades gradually, a named set does
 *  not.
 *
 *  `gpu-fixture-survives-dom.test.ts` is Task E1's proof that a GPU device is still acquirable
 *  after a registration lands mid-process, and it has to be HERE to prove it — "this file
 *  lives in bare tests/ so it proves the fix against the harshest ordering", at source. What
 *  buys it the exemption is the `finally` beside that sentence: it restores `fetch` via
 *  `Object.defineProperty` and deletes `createImageBitmap` / `ImageData` if it added them —
 *  the three globals a repo-wide grep found load-bearing — so the registration does not
 *  outlive the file. An exempt file that skipped that teardown would reintroduce the whole of
 *  finding 1 while sitting on this list, which is the thing to check before adding a second
 *  name. */
const REGISTERS_ON_PURPOSE = ["gpu-fixture-survives-dom.test.ts"];

test("happy-dom registers in a tests/ SUBDIR, never at the top level", () => {
  // A scan that walks nothing passes vacuously. The floor sits far below the count at head so
  // it never needs revisiting, and far above zero so a moved directory cannot hide. Stated as
  // a floor rather than a figure deliberately: a count here would be a number to correct on
  // every added test and nothing reads it.
  const files = bareTests();
  expect(files.length).toBeGreaterThan(20);
  const registrants = files.filter((n) =>
    REGISTERS_DOM.some((re) => re.test(source(n))),
  );
  // The EXACT set, not `[]` minus a skip list. Stated this way the assertion also proves the
  // patterns still match something, which a `toEqual([])` over four regexes that had all
  // quietly stopped working would not.
  expect(registrants).toEqual(REGISTERS_ON_PURPOSE);
});

// ---------------------------------------------------------------------------------------
// (b) every MCP SDK object is constructed inside a `Bun.spawn` child.
//
// Constructing ANY SDK `Protocol` object — `new Client(...)` or `new Server(...)`, no
// transport, no HTTP, no request — costs the REST of the shared process about 3× wall clock.
// Measured at foundations T4b Task 5 on bun 1.3.14 / `@modelcontextprotocol/sdk@1.30.0`:
// the workspace suite went 64 s → 194 s, with 6–7 failures, all of them `@furnace/core`
// wall-clock BUDGET tests dragged over ceilings they otherwise clear by up to 10×. The
// mechanism is unidentified; what it is NOT was established by elimination rather than
// argument (not the transport, not Ajv, not SSE, not `globalThis` pollution, not GC, not
// module load — importing the SDK without constructing anything costs nothing).
//
// The containment is that every construction happens in a fresh runtime:
// `tests/mcp.test.ts` spawns `tests/_helpers/mcp-probe.ts`, which performs the protocol
// exchange and prints one JSON transcript the test asserts on. T4c load-tested that — six new
// tools, five schemas, 17 door cases, and seven gate runs between 54.2 s and 68.2 s against a
// ~64 s baseline. A fresh runtime cannot be polluted by its parent, which is why the remedy is
// structural rather than fragile.
//
// SCOPE. `packages/editor/src/daemon/` legitimately imports the SDK — `daemon/mcp.ts` mounts a
// real server — and is not in scope here by CONSTRUCTION rather than by exemption: this scan
// walks `tests/` and cannot reach it. The production daemon is not implicated either
// (measured: `daemon/mcp.ts` imported and mounted, no object constructed in any test, suite
// 64 s / 0 fail). The rule is about test files, and about them only.

/** Any specifier under the SDK, in either import form. The scoped-package prefix is enough —
 *  every entry point (`/client/index.js`, `/server/index.js`, `/types.js`) shares it, so the
 *  rule cannot be walked around by reaching for a different door.
 *
 *  Written to require a real `from "` or `import("` against the specifier, so the paragraphs
 *  above — which name the package repeatedly — cannot match it. */
const IMPORTS_MCP_SDK: RegExp[] = [
  /from\s+"@modelcontextprotocol\/sdk[^"]*"/m,
  /import\s*\(\s*"@modelcontextprotocol\/sdk[^"]*"/m,
];

/** The one file licensed to hold the SDK, and it is not a test: `tests/mcp.test.ts` spawns it
 *  as a child process and reads its stdout.
 *
 *  The path is the whole licence. A test file that imported this module directly would defeat
 *  the containment completely — the SDK would construct in the parent — which is why the
 *  permission is written as "this module, reached by spawn" and not as "the SDK is fine in
 *  helpers". `tests/action-registry/node-door.test.ts` is the same remedy for a different
 *  pollution and is the precedent this followed. */
const SDK_LICENSED = join("_helpers", "mcp-probe.ts");

test("no test file imports the MCP SDK — every SDK object is built in a spawn child", () => {
  const files = walk(TESTS)
    .map((f) => relative(TESTS, f))
    .sort();
  expect(files.length).toBeGreaterThan(100);
  const importers = files.filter((n) =>
    IMPORTS_MCP_SDK.some((re) => re.test(source(n))),
  );
  // Exact, for the reason rule (a)'s assertion gives: it pins the licensed file AND proves
  // the patterns still match. If `mcp-probe.ts` ever stops importing the SDK this reddens,
  // which is the right moment to ask whether the spawn child is still earning its keep.
  expect(importers).toEqual([SDK_LICENSED]);
});
