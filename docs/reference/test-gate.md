---
verified: 2026-08-18
---

# The test gate

How this repo runs its test suite, and why each part of the shape is a ruling rather than a
default inherited from the tool. The commands themselves live in `AGENTS.md` §Commands and
§Before committing; this file is the argument, the evidence and the reopening trigger behind
them.

The subject is the *gate*. What the harness still cannot do — the shared process's
contamination classes, the flaky cases, the coverage the worker seam hides — is deferred work
and lives in `docs/backlog/editor-and-tooling/`, named per part below.

## The gate

`bun run test` — `bun test --parallel=4` over the whole workspace from the repo root — is the
per-commit gate. `bun run test:serial` (a bare `bun test`) is the **close/review standard**:
run it before sealing a slice or opening a review.

**Both modes run the same population, and that is the point.** They report the same case
count, the same pass count and the same one capability skip; the parallel lane costs a
fraction of the serial wall clock. If the two ever disagree, that disagreement is itself the
bug. The one skip is `test.skipIf` on a genuinely absent capability — `createImageBitmap` /
`ImageData`, in `load.gpu.test.ts` under `packages/core/src/texture/` — and skips identically
in both modes.

Derive the figures rather than reading one here: `bun run test`, `bun run test:serial`.

## Why the run stays whole-workspace, from the root

**The containment the root run depends on is structural, not fragile.** Every construction of
an MCP SDK `Protocol` object costs the rest of the shared process about 3× wall clock, so the
suite builds them only inside a spawn child (`packages/editor/tests/_helpers/mcp-probe.ts`) in
a fresh runtime, which a parent process cannot pollute. The measurement, the eliminations and
the open half of that deferral are
`docs/backlog/editor-and-tooling/mcp-sdk-construction-slows-the-process.md`.

**The stance is machinery rather than discipline.** `packages/editor/tests/harness-conventions.test.ts`
walks `packages/editor/tests/` and asserts that the set of files naming an
`@modelcontextprotocol/sdk` specifier is exactly `_helpers/mcp-probe.ts`, so an argument for
changing the gate cannot rest on "the convention might slip". Its sibling
`packages/editor/tests/register-first.test.ts` holds where the happy-dom registration line must
sit inside the two DOM subdirectories.

**Per-package runs are a DIAGNOSTIC, never a candidate gate**, for two reasons.

*They buy no wall clock.* Dated snapshot, measured at `0fd37ad7` on a machine also running
concurrent agent sessions — read the figures against each other, not as absolutes: 69.57 s
summed across `bun test packages/core` / `packages/dungeon` / `packages/editor`, against
71.66 s for one root run. Three process startups pay back whatever the split saves, which is
what to expect once the pollution a split would avoid is already contained. Re-derive with
those four commands.

*And they do not cover the workspace.* Six test files live outside those three packages —
`packages/cookbook/tests/demos.test.ts`, `packages/hello-world/tests/triangle-shader.test.ts`,
and four root `scripts/*.test.ts` files that live in no package at all. Adopting the
three-command form as the gate would silently drop them. Derive the current set:
`git ls-files | grep -E '\.test\.(ts|tsx)$' | grep -vE '^packages/(core|dungeon|editor)/'`.

As a diagnostic — *is this failure a cross-package interaction or not?* — the three are the
right three, and they owe a fourth command as a gate.

## Why four workers

`bun test --parallel` implies `--isolate` and defaults to one worker per core. **That default
saturates this laptop**, and a saturated machine is the wrong place to measure a wall-clock
ceiling.

What that looks like, stated precisely because an earlier description of it was wrong in both
halves: at default width the failing **set is load-dependent** and reaches files carrying no
budget at all — four runs at default width shared only one failing case between them, and two
of the four reddened `packages/editor/tests/harness-conventions.test.ts`, which has no budget
in it. The failure **mode is an assertion against a ceiling, not a timeout being blown**: the
failures carry `type="AssertionError"`, no run mentions a timeout, and the longest budget case
observed ran inside bun's 5 s default. One run also hung outright with a single worker alive
and no further output. Sighting record: `docs/backlog/infrastructure/bun-parallel-worker-panic.md`.

At the ruled `--parallel=4` those cases return to essentially their serial timing. **The
worker count IS the budget policy**: choosing it is the cheaper lever and the honest one, and
the same lever buys back the headroom this machine needs when a second agent session is
running.

For attributing any red `--parallel` run: capture full stdout **and** take a junit run
(`--reporter=junit --reporter-outfile=<file>`), because stdout alone has been observed
reporting `2 fail` with no failure detail anywhere in a complete 5,289-line capture. Parse the
junit for the `.test.ts`-named testsuites only — file-level and `describe`-level suites both
carry each case, so a naive total double-counts.

## Why the wall-clock budgets are not calibrated

Baseline-relative wall-clock budgets are **declined**. Nothing was calibrated when contention
made the ceilings fail; the worker count was fixed instead.

The reason is what a ceiling is a claim about. **An absolute ceiling is a claim about the
ENGINE, which a reader can argue with; a baseline-relative one is a claim about the machine,
which drifts with it and can never fail.** Contention was never evidence that the ceilings are
wrong — it was evidence that a saturated machine is the wrong place to measure them. Fixing
the measurement condition keeps every ceiling an argue-able claim. No budget file is edited
and no per-file timeout is raised.

## `--isolate` is usable, and rests on two workarounds

`bun test --isolate` and `bun test` return the same population and the same result. That was
not always true: both blocking mechanisms turned out to be one Bun defect rather than anything
this repo did wrong, and two sites work around it —

- `trySetup` in the `gpu-fixture.ts` helpers under `packages/core/tests/_helpers/` and
  `packages/dungeon/tests/_helpers/`, which resolve bun-webgpu's native library synchronously
  and pass an explicit `libPath`;
- `_harness.tsx` under `packages/editor/tests/inspector/`, which pulls testing-library through
  a synchronous `createRequire` rather than a top-level await.

Both are the correct code until the defect is fixed upstream. Mechanism, minimal repro, and
the trigger that deletes both:
`docs/backlog/infrastructure/bun-isolate-top-level-await-tdz.md`.

## What the gate does not contain

**An async leak crosses a file boundary that even `--isolate` would not close**, if the timer
outlives the isolate. A `bun test` process with no per-file isolation cannot contain an
unsettled promise any better than a synchronous one, and none of the gate levers above
addresses that half: a pending ask surviving its own test file rejects later inside whatever
file bun happens to be running by then, as an unhandled rejection attributed to a stranger,
and the failure moves between runs. That stays **per-site discipline** — every case that opens
an ask settles it. The incident that established the class, and the `EventHub.close()` gap
behind it, are recorded at `docs/reference/editor-architecture.md` §27.5 and filed as
`docs/backlog/editor-and-tooling/backchannel-refusals-blur-two-causes.md` item 2.

**The shared process still has no per-file isolation in the serial lane**, which is the
mechanism behind the DOM/GPU/daemon ordering dependencies. Enforcing where a DOM file sits
does not remove the dependency on where it runs. Open:
`docs/backlog/editor-and-tooling/bun-test-single-process-fragility.md`.

## What would reopen each part

- **The worker count** — a budget-file failure under `--parallel=4`. That is the signal that 4
  is no longer an uncontended-enough measurement condition on the machine of the day, and the
  next lever is the worker count again, not the budgets.
- **The declined calibration** — a SECOND contamination class of the synchronous kind. The
  decline rests on the first one being contained, and that is the premise a single new finding
  could knock out.
- **The whole-workspace root run** — an SDK upgrade (re-measure the 3× table first, since a v2
  SDK may not have this at all), or MCP coverage the spawn-child transcript shape cannot
  express. Both are the trigger on
  `docs/backlog/editor-and-tooling/mcp-sdk-construction-slows-the-process.md`.
- **The `--isolate` workarounds** — a Bun upgrade, per
  `docs/backlog/infrastructure/bun-isolate-top-level-await-tdz.md`.

## Reference

- `AGENTS.md` §Commands, §Before committing — the commands this file argues for.
- `packages/editor/tests/harness-conventions.test.ts`, `packages/editor/tests/register-first.test.ts`
  — the two scans that hold the containment.
- `packages/core/tests/_helpers/gpu-fixture.ts`, `packages/dungeon/tests/_helpers/gpu-fixture.ts`,
  `packages/editor/tests/inspector/_harness.tsx` — the `--isolate` workaround sites.
- `docs/learnings/seals/2026-08-14-isolate-hardening.md` — the seal this ruling closed under,
  including the review round that corrected the default-width failure description above.
- `docs/backlog/editor-and-tooling/` — the harness deferrals this gate does not close.
