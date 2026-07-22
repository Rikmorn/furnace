# bun test single-process fragility: DOM (happy-dom) vs GPU tests interleave badly

**Context.** `bun test` runs all editor test files in ONE shared process and walks
top-level `tests/*.ts` files before `tests/<subdir>/*`. The happy-dom harness
(`tests/inspector/_register.ts` → `GlobalRegistrator.register()`) mutates
process-global state, which collides with two other test families:

1. **Global `fetch` pollution.** A happy-dom-registering test (or a full `<App/>`
   render / `mock.module` of the frontend `api.ts`) placed in BARE `tests/`
   breaks the daemon HTTP suites (`server.test.ts`, `project-assets.test.ts`)
   that run later in the same process. (Surfaced in Slice 3.2.2 Task 5.)
2. **`navigator.gpu` clobber.** happy-dom installs a `navigator` with no `.gpu`.
   If a happy-dom test runs BEFORE a `*.gpu.test.ts` (which top-level files do,
   by file-walk order), every later GPU test throws "WebGPU unavailable".
   (Surfaced in Slice 3.2.2 Task 7 — 13 GPU failures until the DOM test was
   moved from `tests/theme.test.ts` into `tests/inspector/`.)

**Current mitigation (convention, not enforced):** every DOM/happy-dom test lives
in a `tests/` SUBDIR (`tests/inspector/`, `tests/chrome/`), never bare `tests/`,
so it sorts AFTER the top-level `*.gpu.test.ts` and the daemon HTTP suites in the
file walk. This works today but is fragile — it relies on alphabetical file-walk
ordering and a placement comment, and a new bare-`tests/` DOM file silently
reintroduces either failure.

3. **Radix PORTAL content does not render unless a `tests/inspector/` file ran
   first.** Found in F3a Task 8 (2026-07-22). `bun test` from the repo root is
   green, but a narrower invocation is not: `bun test packages/editor/tests/chrome/`
   fails 10/45 — every assertion that queries menu or dialog CONTENT
   (`menubar.test.tsx` 6, `confirm-dialog.test.tsx` 3, `view-flags` 1). The
   trigger element itself flips correctly (`data-state="open"`,
   `aria-expanded="true"`); the portalled content is simply absent from the DOM.
   It is NOT a first-file-in-process effect: `menubar` + `confirm-dialog`
   together still fail both. It IS fixed by running certain inspector files
   first — `color-field`, `entities-panel`, `number-field`, `scrub-affordance`
   and `vec-field` each make `confirm-dialog` pass, while `boolean-field`,
   `inspect-panel`, `object-field` and `schema-form-mixed` do not. Root cause not
   identified (suspect a happy-dom global some component touches lazily). The
   practical cost today: any NEW chrome behaviour built on a Radix portal is
   untestable in a single-file run, which is how a task-scoped gate is usually
   run — F3a Task 8 chose three inline row buttons over the planned ⋯ dropdown
   for exactly this reason.

**A real fix worth designing when this bites again:** isolate the environments —
e.g. a separate `bun test` invocation (or bunfig test project) for DOM tests vs
GPU tests vs daemon tests, so global state can't leak across families; or a
per-file teardown that unregisters happy-dom. Either removes the ordering
dependency entirely.

**Trigger to revisit:** the next time a DOM+GPU or DOM+daemon test-ordering
failure appears, or when the suite grows enough DOM tests that the subdir
convention becomes unwieldy. Not urgent — the convention holds for now.

**Reference:** `packages/editor/tests/inspector/_register.ts`; placement comments
in `tests/inspector/theme.test.ts` and `tests/chrome/*`; surfaced in Slice 3.2.2
Tasks 5 and 7.
