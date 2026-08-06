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
 *  resolves the way the daemon will resolve it. */
async function rowsSeenByABareRuntime(
  specifier: string,
  count = "m.ACTION_DESCRIPTORS.length",
): Promise<{ ok: boolean; text: string }> {
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      `const m = await import(${JSON.stringify(specifier)}); console.log(${count});`,
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

test("the package export map reaches it — the daemon's route in", async () => {
  // `bundle.test.ts`'s note names the failure mode this covers: the daemon bundles from the
  // CONSUMER's root, so it names editor modules by BARE SPECIFIER. A module with no export
  // map entry is unreachable from there however clean it imports, and nothing else in this
  // suite would notice — `field-host` was the only entry until this task added a second.
  const r = await rowsSeenByABareRuntime("@furnace/editor/action-registry");
  if (!r.ok) throw new Error(`the export map did not resolve:\n${r.text}`);
  expect(Number(r.text)).toBeGreaterThan(0);
});

test("the input schemas open too — the zod half of the layer is Node-portable", () => {
  // A SEPARATE DOOR because it is a separate module and a separate risk. `schemas.ts` is the
  // one file under this directory the chrome may not value-import (it carries zod, and
  // behind it `@furnace/core`), which means the barrel deliberately re-exports its TYPES
  // only — so the door above imports it not at all and would stay green if this module could
  // not load at all. It is also the only one whose graph reaches outside the package, which
  // is the thing most likely to break in a bare runtime.
  //
  // No bare-specifier half: there is no export-map entry for it yet, and there should not be
  // one until the projection that reads it exists (T4). This door is by path.
  return rowsSeenByABareRuntime(
    join(PKG, "src", "action-registry", "schemas.ts"),
    "Object.keys(m.ACTION_INPUT_SCHEMAS).length",
  ).then((r) => {
    if (!r.ok) throw new Error(`a bare runtime refused the import:\n${r.text}`);
    expect(Number(r.text)).toBe(6);
  });
});
