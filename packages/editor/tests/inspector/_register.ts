// Side-effect module: registers happy-dom's globals (document/window/etc.) onto
// globalThis so @testing-library/react can bind to a real DOM under `bun test`.
//
// This MUST be imported before @testing-library/react anywhere in a test's module
// graph: testing-library binds `screen` to `document.body` at module-evaluation
// time, so the DOM has to exist first. `_harness.tsx` imports THIS file on its first
// line and pulls testing-library in via a DYNAMIC import afterwards, which is what
// makes that ordering hold regardless of where a test file puts its harness import.
//
// The rule this comment used to state — "each test file imports `_harness.tsx` on ITS
// first line" — was measured FALSE at F4.5c Task 12: Biome's `organizeImports` sorts
// `./_harness.tsx` below `../../src/…`, so no file honours it and `bun run check`
// reverts any attempt to make one. The spelling that DOES hold is a bare side-effect
// import of THIS module, first in the file, which Biome leaves where it is put:
//
//     import "../inspector/_register.ts";
//
// Every chrome test carries it (the "shell.test.tsx rule"), and that sentence is now held
// by a scan rather than by trust — `tests/chrome-register-first.test.ts` reddens, naming
// the file, if one ever does not. It had been wrong in prose twice before the scan existed.
//
// It matters for any module that captures `globalThis.document` at LOAD time rather than
// at render — Radix's `useLayoutEffect` shim, and therefore every Radix PORTAL. Without it
// a file that imports a portal-using component before the harness gets a trigger that opens
// onto nothing, and only in runs where no other file registered first, which is as
// intermittent as it sounds. Three chrome files were missing it until the F4.5c Task 12
// review, and they were the whole of the "confirm-dialog poisons the directory" folklore:
// adding the line took `bun test packages/editor/tests/chrome` from ~130 failures in ~51 s
// to ZERO in ~10 s. (The ratio and the clock, not a pass total — that number moves with
// every case anyone adds.) See `enum-field.test.tsx`'s header for the mechanism.
//
// Registration is deliberately scoped to files that import the harness (NOT a bun
// `--preload`) so `document`/`window` are never injected into the daemon/server/GPU
// test runs, which would break them.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Idempotent: bun runs every test file in one process, so guard against a second
// registration (GlobalRegistrator.register() throws if the DOM is already global).
// Boundary cast: `document` isn't on the Node `globalThis` type; happy-dom installs
// it at runtime, so we read it through a widened shape to feature-detect it.
if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  GlobalRegistrator.register();
}
