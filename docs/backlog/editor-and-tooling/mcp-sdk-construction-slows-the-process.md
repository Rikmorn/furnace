---
summary: constructing any MCP SDK `Protocol` object — no transport, no request — costs the REST of the shared `bun test` process about 3x wall clock; contained by building every one inside a spawn child, and the mechanism is still unidentified
---

# Constructing an MCP SDK object triples the rest of the `bun test` process

**Context.** Measured at foundations T4b Task 5 (2026-08-09), on `bun` 1.3.14 with
`@modelcontextprotocol/sdk@1.30.0`. Constructing **any** SDK `Protocol` object — `new
Client(...)` or `new Server(...)`, with no transport, no HTTP and no request — costs the
REST of the shared test process about **3× wall clock**. It belongs in this file because it
is the same absence of per-file isolation `bun-test-single-process-fragility.md` is about,
arriving from a
new direction: a dependency, not a global.

| run | wall clock | fails |
| --- | --- | --- |
| `bun test` (workspace), no MCP object anywhere | 64 s | 0 |
| `bun test` (workspace), one MCP object in one test file | 194 s | 6–7 |
| `bun test packages/editor`, no MCP object | 31.4 s | 0 |
| `bun test packages/editor`, one `new Client()` and nothing else | 48.5 s | 0 |
| `bun test packages/editor`, the MCP work in a `Bun.spawn` child | 32.0 s | 0 |

The failures are all `@furnace/core` **wall-clock budget** tests, dragged over ceilings they
otherwise clear by up to 10× (`cave carve — budget` 148 ms → 1581 ms against a 500 ms
ceiling; `flood-material` 79.8 ms → over its 100 ms ceiling). The production daemon is not
implicated: with `daemon/mcp.ts` imported and mounted but no MCP object constructed in any
test, the workspace suite is 64 s / 0 fail.

**What it is NOT** — each eliminated by measurement rather than by argument: not the
transport (`new Server(...)` alone, no transport, reproduces it in full); not Ajv (`new
Ajv()` alone reproduces none of it, and supplying the SDK's `jsonSchemaValidator` option —
which skips the default Ajv construction entirely — changes nothing); not SSE
(`enableJsonResponse: true` changes nothing); not `globalThis` pollution (nothing added,
removed or re-attributed around the call); not GC pressure (a forced collection afterwards
changes nothing); not module load (importing the SDK without constructing anything costs
nothing, and `daemon/server.ts` imports it on every run regardless). The mechanism is
unidentified. The symptom is diffuse — CPU- and allocation-heavy tests slow the most, a
tight `Math.sqrt` loop not at all — and the magnitude matches what
`tests/gpu-fixture-survives-dom.test.ts` records for `GlobalRegistrator.unregister()`.

**How T4b lives with it.** `tests/mcp.test.ts` spawns `tests/_helpers/mcp-probe.ts` in a
fresh runtime, which performs every protocol exchange and prints one JSON transcript the
test file asserts on — the same remedy, and the same argument, that
`tests/action-registry/node-door.test.ts` already uses for a different kind of process
pollution. Nothing in `src/` changed to accommodate it.

**ENFORCED since foundations T5 (2026-08-11)**, by the same
`packages/editor/tests/harness-conventions.test.ts`: no file under `packages/editor/tests/`
may name a `@modelcontextprotocol/sdk` specifier except `tests/_helpers/mcp-probe.ts`, which
is asserted by name. `packages/editor/src/daemon/` is out of scope by construction rather than
by exemption — `daemon/mcp.ts` mounts a real server and the scan does not walk `src/`. It was
a convention held by discipline until then, and it held: T4c's seven gate runs are the
evidence, in the section below. What it did NOT have was anything that would say so on the
day someone imported the SDK straight into a test file, which is a one-line change with a
3× bill attached.

**Why it is filed rather than fixed.** The fix is either upstream (an SDK whose shape we do
not control) or a change to how this repo gates: per-package `bun test` runs in separate
processes (verified green — core 20.2 s, dungeon 11.3 s, editor 48.6 s, each alone), or
`bun test --isolate` (**not** usable today: 32 fails, since the GPU fixtures depend on
shared process state), or making the core wall-clock budgets calibrate against a
per-process baseline instead of an absolute ceiling. All three are program-level decisions
about the gate — **and all three are ruled in `docs/reference/test-gate.md`**, which is where
that question now lives. *(It lived in the last section of this tracker until the tracker was
un-merged at genre-contracts; the ruling is true-now, so it moved to the reference register.)*

**Trigger to revisit:** an SDK upgrade — re-measure the table first, since a v2 SDK may not
have this at all; OR any move to change the repo's gate command, which should settle this at
the same time; OR MCP coverage the transcript shape cannot express (a streaming tool, an
interleaving the probe cannot script). *(The T4c clause of this trigger is spent — see the
next section.)*

**What changed at isolate-hardening (2026-08-13).** The paragraph above offers three gate
options and rules out one of them in passing; that parenthetical is now false, and the second
clause of the trigger directly above has FIRED — the repo's gate command did change. Recorded
here as a dated correction rather than by editing the prose, which stands as a record of what
was true when it was written.

- **"`bun test --isolate` (not usable today: 32 fails, since the GPU fixtures depend on shared
  process state)" is wrong twice over and is struck.** The stated mechanism was already refuted
  by the 2026-08-13 correction at the foot of the T5 section (a GPU file alone under `--isolate`
  skips too, so no cross-file state is involved). The *conclusion* is now wrong as well:
  `--isolate` is usable, and **`bun test --parallel=4` — which implies `--isolate` — is the
  repo's per-commit gate**, with the serial run kept as the close/review standard. Command,
  wording and the reason the worker count is 4 live in `AGENTS.md` §Commands and §Before
  committing.
- **Both blocking mechanisms were one Bun defect, not repo defects**, and the two sites that
  work around it are `trySetup` in the `gpu-fixture.ts` helpers under `packages/core/tests/` and
  `packages/dungeon/tests/` (which resolve bun-webgpu's native library synchronously and pass an
  explicit `libPath`), and `_harness.tsx` under `packages/editor/tests/inspector/` (which pulls
  testing-library through a synchronous `require`). Mechanism, minimal repro, and the trigger to
  delete both:
  [`bun-isolate-top-level-await-tdz.md`](../infrastructure/bun-isolate-top-level-await-tdz.md).
- **The third option in that paragraph — calibrating the core wall-clock budgets against a
  per-process baseline — was NOT taken**, and deliberately: see the RULED 2026-08-13 block at
  `docs/reference/test-gate.md`, which carries the evidence, the worker-count ruling that
  made calibration unnecessary, and the answer the declined-calibration objection was owed.
- **The first option — per-package runs — remains a diagnostic, not a gate**, for the coverage
  reason clause 3 gives; nothing in this slice touched that.

Derive the current state rather than reading a number here: `bun run test`, `bun run test:serial`,
`bun test --isolate`.

**Reference:** `packages/editor/tests/_helpers/mcp-probe.ts` (the measurement and the
eliminations, at source); `packages/editor/tests/action-registry/node-door.test.ts` (the
`Bun.spawn` precedent); `packages/editor/tests/harness-conventions.test.ts` (the scan that
holds the containment, since T5).

## What foundations T4c actually hit — the prediction was right, the class was wrong

**The prediction: "T4c will hit this wall again." It did NOT.** Whole-workspace `bun test` from
the repo root, read off each commit's own gate line (2026-08-09 → 2026-08-10) — **Task 0
64.9 s, Task 1 54.4 s, Task 2 64 s, Task 4 54.2 s, Task 5 67 s, Task 6 66.1 s, Task 7 68.2 s**.
*(Task 3 recorded its pass/fail counts but not a wall clock, so there are seven gates and six
figures plus this file's own; the gap is stated rather than interpolated.)* Baseline ~64 s, and
the ~90 s tripwire that a 3× multiple would have blown through on its first appearance was never
approached. The suite grew 3,057 → 3,201 cases and the wall clock did not move. **The containment held for exactly the
reason it was designed to**: the tranche added six MCP tools, five argument schemas and 17
door cases, and **every SDK object construction stayed inside `tests/_helpers/mcp-probe.ts`'s
spawn child**. Nothing in `src/` was shaped around it and nothing needed to be. That is the
first real load test of the remedy above, and it is worth recording as a positive: the fix is
not fragile, it is structural — a fresh runtime cannot be polluted by the parent's SDK.

**A DIFFERENT contamination class bit instead, and it belongs in this file because it is the
same absence of per-file isolation arriving from a third direction: an unsettled PROMISE.**

At T4c Task 3, three brokered-command cases opened a backchannel ask and never answered it.
`EventHub.close()` deliberately does not fire its close handlers, so `abandonAsksOn` never runs
at teardown and a pending ask **survives its own test file** on an `unref`'d timer. It then
rejects up to its budget later — 30 s for `generate` — inside **whatever file bun happens to be
running by then**, as an unhandled rejection attributed to a stranger. Measured while writing
those cases: three unsettled asks reddened `tests/chrome/tool-rail.test.tsx` with
`session-timeout: "generate"`, a file that names none of this, **and the failure MOVED between
runs** as scheduling shifted.

**Why it is worse than the SDK cost even though it is smaller.** The SDK multiple is loud,
reproducible and points at itself. This one is silent until it isn't, blames an innocent file,
and is non-deterministic — the three properties that make a suite untrustworthy rather than
slow. A reader who bisects on the reddened file learns nothing.

**How it was fixed, and what is left.** Per-site: every case that opens an ask now settles it,
with the discipline stated at the top of `tests/session-mutation.test.ts` and the accepting
half of `tests/session-query.test.ts`'s validation case deliberately NOT asserted for exactly
this reason (a request the schema admits is relayed, so asserting it would open an ask nothing
answers). **The underlying gap is filed, not fixed**, at
`docs/backlog/editor-and-tooling/backchannel-refusals-blur-two-causes.md` item 2 — `hub.close()`
firing no close handlers, which that entry had recorded as "unreachable today". **T4c is its
first live evidence**, and it arrived from the test harness rather than from the daemon
shutdown path the entry anticipated.

**The general rule this suggests, stated rather than adopted:** a `bun test` process with no
per-file isolation cannot contain an async leak any better than it contains a synchronous one,
and the three remedies listed above (per-package runs, `--isolate`, calibrated budgets) address
only the synchronous half. An unsettled promise crosses a file boundary that even `--isolate`
would not close if the timer outlived the isolate. Nothing here proposes a fix; it is context
for the gate question, which `docs/reference/test-gate.md` settles.
