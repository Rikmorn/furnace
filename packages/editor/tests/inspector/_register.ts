// Side-effect module: registers happy-dom's globals (document/window/etc.) onto
// globalThis so @testing-library/react can bind to a real DOM under `bun test`.
//
// This MUST be imported before @testing-library/react anywhere in a test's module
// graph: testing-library binds `screen` to `document.body` at module-evaluation
// time, so the DOM has to exist first. ES modules evaluate imports in source order,
// so `_harness.tsx` imports THIS file on its first line, and each test file imports
// `_harness.tsx` on ITS first line — guaranteeing registration runs before any
// DOM-touching module loads.
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
