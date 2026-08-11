// THE NODE DOOR. `src/action-registry/` exists so a process with no DOM can hold the
// editor's verbs; this file is the only thing that proves it, and it proves it by DOING it
// rather than by describing it.
//
// WHY A REAL IMPORT AND NOT A REGEX. The three source rules in `no-chrome-leakage.test.ts`
// scan specifiers, which catches React and the two neighbouring layers by name in the two
// STATIC import forms those rules cover (`import … from "x"` and the side-effect
// `import "x"`) — not in `await import(…)` or `require(…)`, which that file explains it
// deliberately does not chase. They cannot catch the DOM at all: `KeyboardEvent` in a type
// position is erased, `document` and `window` are ordinary English words in files this dense
// with prose, and the interesting failure — something in the module GRAPH touching a browser
// global as it loads — is not spelled in this directory's source at all. Importing the
// module is the check.
//
// WHY A SUBPROCESS, and this is the correction of a real defect rather than belt-and-braces.
// The obvious spelling — `await import(…)` right here — is a door that only closes when this
// file runs alone, and the first version of it made exactly that mistake. `bun test` shares
// ONE process across this package's files; `tests/gpu-fixture-survives-dom.test.ts` runs at
// file 47 of the package run and this one at 69–71; that file calls
// `GlobalRegistrator.register()` and deliberately does NOT `unregister()` — its `finally`
// restores `fetch`, `createImageBitmap` and `ImageData` and nothing else, for a measured
// reason documented there. So by the time an in-process import ran, `document` existed, and
// a module-scope `document.title` in the registry would have sailed straight through. The
// guard was accidentally true in isolation and false in the run that matters.
//
// `Bun.spawn` fixes that at the root rather than by ordering: the child is a fresh runtime
// with no happy-dom in it, whatever this process has done to its own globals. The claim
// becomes unconditional, which is the only kind a layer's foundation should make.
//
// WHAT IT STILL DOES NOT PROVE, stated because a guard trusted for more than it holds is
// worse than none: that no function BODY in there would reach for a DOM global if CALLED.
// Nothing does today — `matchBinding` takes facts, which is the whole design — and the
// source rules plus review are what keep it that way.
//
// NOTHING FROM `frontend/` MAY BE IMPORTED HERE, and that is not tidiness either: pulling
// `lib/actions.ts` in for a comparison would load the chrome's graph and the door would be
// answering a different question. The comparison against the live table is a separate file
// (`descriptors.test.ts`) on purpose.
import { expect, test } from "bun:test";
import { join } from "node:path";

const PKG = join(import.meta.dir, "..", "..");

/** Import `specifier` in a FRESH bun process and report what `count` found there.
 *
 *  The child prints a COUNT rather than exiting silently, so "imported cleanly" and
 *  "imported cleanly and exported nothing" are distinguishable — a door that read only the
 *  exit code would pass on an empty module. `cwd` is the package root, so a bare specifier
 *  resolves the way the daemon will resolve it.
 *
 *  **`String(...)`, NOT the bare number, and that is a fix rather than a flourish.**
 *  `console.log` hands a NON-STRING argument to the runtime's inspector, which colourises it
 *  whenever colour is forced — under `FORCE_COLOR` (set by some shells, and commonly by CI)
 *  the child prints `\x1b[0m\x1b[33m39\x1b[0m` and the `Number(...)` below reads `NaN`, so all
 *  three cases fail on an import that worked perfectly. A lone string is written through
 *  untouched, which makes the child's stdout machine-readable BY CONSTRUCTION rather than by
 *  the parent's environment happening to be quiet. */
async function rowsSeenByABareRuntime(
  specifier: string,
  count = "m.ACTION_DESCRIPTORS.length",
): Promise<{ ok: boolean; text: string }> {
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      `const m = await import(${JSON.stringify(specifier)}); console.log(String(${count}));`,
    ],
    { cwd: PKG, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, text: (code === 0 ? out : err).trim() };
}

test("the action registry imports clean in a bare runtime", async () => {
  const r = await rowsSeenByABareRuntime(
    join(PKG, "src", "action-registry", "index.ts"),
  );
  // Rethrown rather than asserted, so the child's own diagnostic is what a reader sees —
  // `bundle.test.ts` reports its esbuild failures the same way.
  if (!r.ok) throw new Error(`a bare runtime refused the import:\n${r.text}`);
  expect(Number(r.text)).toBeGreaterThan(0);
});

test("the package export map RESOLVES the bare specifier — with no importer yet", async () => {
  // WHAT THIS COVERS, restated at T4b Task 7 because its old name ("the daemon's route in")
  // was the premise T4b measured and refuted. `bundle.test.ts`'s note is about the
  // CONSUMER-ROOT door: the daemon bundles a generated entry from someone else's project
  // root, so anything named THERE must be a bare specifier, and a module with no export-map
  // entry is unreachable however cleanly it imports. That is a real failure mode and this
  // case is a real guard on it. What is NOT true is that the daemon is the caller: T4b's MCP
  // door reads this directory not at all, the daemon's own source uses relative paths, and
  // `grep -rn "@furnace/editor/action-registry" packages/` finds no importer at all today.
  // So this pins that the entry RESOLVES and the graph loads through it — which is what
  // keeps the entry honest until an outside-the-package consumer arrives to use it.
  const r = await rowsSeenByABareRuntime("@furnace/editor/action-registry");
  if (!r.ok) throw new Error(`the export map did not resolve:\n${r.text}`);
  expect(Number(r.text)).toBeGreaterThan(0);
});

test("the input schemas open too — the zod half of the layer is Node-portable", async () => {
  // A SEPARATE DOOR because it is a separate module and a separate risk. `schemas.ts` is the
  // one file under this directory the chrome may not value-import (it carries zod, and
  // behind it `@furnace/core`), which means the barrel deliberately re-exports its TYPES
  // only — so the door above imports it not at all and would stay green if this module could
  // not load at all. It is also the only one whose graph reaches outside the package, which
  // is the thing most likely to break in a bare runtime.
  //
  // NO BARE-SPECIFIER HALF, AND T4b TESTED THAT TRIGGER RATHER THAN DEFERRING IT AGAIN. This
  // note used to read "until the projection that reads it exists (T4)". T4b's projection
  // landed — `daemon/mcp.ts`, three tools over the MCP transport — and read this module not at
  // all, because those three tools carried hand-written argument documents. **T4c changed the
  // first half and not the second.** `daemon/session-handlers.ts` now imports
  // `action-registry/schemas.ts` for real, by RELATIVE path, which is what this case exists to
  // keep loadable on a DOM-free runtime; the door's nine rows still reach it only through that
  // command, so the bare-specifier half stays untriggered.
  //
  // The trigger is also narrower than "the day the daemon needs one", and that is the part
  // worth writing down. The export map is the CONSUMER-ROOT door: `daemon/bundle.ts:37` writes
  // `@furnace/editor/field-host` into a generated entry that esbuild resolves with
  // `resolveDir: root` (`:42`) — someone else's project — which is why THAT specifier must be
  // bare. The daemon's own source reaches in-package modules by relative path, so even T4c's
  // projection can import `../action-registry/schemas.ts` and still need no entry.
  // `shared/tool-registry.ts:33-35` reached the same verdict for the floor, before MCP
  // existed to test it.
  //
  // So adding an entry to give this case a bare-specifier half would make the case a check on
  // its own commit: the path door below already proves the graph LOADS in a bare runtime, and
  // the bare half would prove only that the entry someone just wrote exists. What the schemas
  // needed instead was a check on their CONTENT, and that is
  // `projection-round-trip.test.ts` — the advertised JSON Schema and the enforced zod schema
  // held to the same verdict. This door is by path.
  const r = await rowsSeenByABareRuntime(
    join(PKG, "src", "action-registry", "schemas.ts"),
    "Object.keys(m.ACTION_INPUT_SCHEMAS).length",
  );
  if (!r.ok) throw new Error(`a bare runtime refused the import:\n${r.text}`);
  expect(Number(r.text)).toBe(6);
});
