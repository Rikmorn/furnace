# `bun --hot serve.ts` serves a stale `@furnace/core` bundle (June 2026)

*Restart the dev server after editing `@furnace/core` before trusting a visual
checkpoint. Re-navigating is not enough.*

## The gotcha

The dungeon/hello-world dev loop is `bun --hot serve.ts`. On navigation it
re-bundles the **entry package's own files** (e.g. `packages/dungeon/src/main.ts`)
fresh, but it serves a **cached bundle of the `@furnace/core` workspace
dependency captured at server startup.** Edit anything under
`packages/core/src/**` while the server stays up and the browser keeps running
the OLD core — the workspace symlink resolves at bundle time, and that bundle was
frozen when the server booted.

## How it bit this epic

After the Task 4 core fog change (the new `lit`-shader fog path in
`packages/core/src/shader/lighting.ts` + `frame/lights.ts`), the fog visual
checkpoint showed **zero fog on lit surfaces even at extreme density**. At the
same time `bun test` (which runs live `src`) passed and source review was green —
the change was correct.

Root cause: the dev server had been alive since *before* the core change, so the
browser was running the pre-fog `lit` shader out of the startup-cached core
bundle. The dungeon's own `main.ts` (fog color/density wiring) re-bundled fine on
navigation, which masked it — the consumer-side change looked applied, only the
engine-side change was stale. The symptom ("density does nothing") pointed at the
fog math, not the build, so it cost time.

## How to apply

- Edited `@furnace/core/src/**`? **Restart** the dev server before trusting a
  visual checkpoint — don't just re-navigate or hard-reload the tab.
- Editing only the entry package's own files (`packages/dungeon/src/**`,
  `packages/hello-world/src/**`)? Navigation re-bundles those, so a reload is
  enough — no restart needed.
- When a visual result contradicts a green `bun test` + clean source review,
  suspect a stale bundle before suspecting the new code: tests run live `src`,
  the browser runs the startup-cached core bundle.
