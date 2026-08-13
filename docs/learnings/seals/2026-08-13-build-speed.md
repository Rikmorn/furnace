# Build-speed — one typecheck lane, the docs-only gate, an overruling

- **Sealed** — 2026-08-13
- **Package(s)** — cookbook, core, dungeon, editor, hello-world (one deleted script line
  each; the substance is root `package.json` + `tsconfig.json` + root docs)
- **Gate** — headless: `bun run check` · `bun run typecheck` · full root `bun test`, with
  sabotage-verified coverage; no visual surface, Safari gate N/A
- **Suite** — 3,292 pass / 1 skip / 0 fail across 376 files (`bun test`)

Five commits, 13 files, +45/−160 (`git diff --stat 28fd6a1d..97799611`) — a net-deletion
slice. Reviewer verdict CLOSE with two values-rule minors, both fixed on the branch
(`97799611`).

## What sealed

**The five-lane typecheck was pure redundancy, and deletion beat parallelising.** Verified
from source before acting: the three package tsconfigs that existed were `extends` +
`include` with no `compilerOptions`, and the hello-world/dungeon lanes had no tsconfig at
all, so `bunx tsc` resolved the root config from their cwd — the gate ran the whole-repo
check twice and called it two lanes. The root project is a strict superset of all five.
`bun run typecheck` is now one root-project `tsc --noEmit --incremental` run (buildinfo in
`node_modules/.cache/`, auto-created). Measured at take (`time bun run typecheck`): 22.9 s
five-lane → 6.9 s cold / 2.05 s warm; a leaf-package edit re-checks in ~2.1 s; a core edit
≈ cold, because core is the import-graph root. Root `scripts/` is gate-covered by
construction now — the coverage-gap backlog entry resolved by deletion of the thing that
caused it.

**The gate's file set is clone-independent now.** The root glob was pulling gitignored
scaffolding into the program (18 `docs/superpowers` files and the wasm-pack `pkg/` outputs
at measurement). Both are excluded. Sabotage-verified in both directions: type errors in
`scripts/`, dungeon, and hello-world each went red; a probe file inside `docs/superpowers`
stayed green and the same probe moved to `docs/` proper went red — the exclusion probe had
to be proven non-vacuous because the first attempt sabotaged a `.d.ts` (skipped by
`skipLibCheck`) and the second targeted a directory that held zero `.ts` files.

**Docs-only commits gate on `bun run check` alone** — one ratified sentence in AGENTS.md
§Before committing. Full gate unchanged at tranche close/review.

**The scoped-gate script was OVERRULED at take** (owner, 2026-08-13: "doesn't earn it"),
reversing the tooling session's "scoped gates by dep graph — the ruling wants a script".
The arithmetic: with the typecheck collapse landed and isolate-hardening queued, the full
warm gate projects to ~12–17 s, where selection logic saves ~10 s at best and costs a
changed-files→blast-radius mapping that can lie in the under-gating direction. Revisit
trigger (recorded on the isolate-hardening work item): that slice walls and the suite
stays serial. For any future re-pricing: bun ≥1.3.14 ships `bun test --changed`, measured
import-graph-aware at the tooling digest — but blind to non-import couplings (shared
dirs, generated artifacts), which is exactly the lie-risk that killed the script.

## Durable finds

- `skipLibCheck: true` means hand-written `.d.ts` files are type-checked nowhere —
  pre-existing, identical under the old lanes, ruled fine and expected at review.
- `packages/cookbook/src/shared/demos-manifest.ts` is gitignored, generated, and required
  for typecheck to pass on a fresh clone — pre-existing, unchanged.
- `packages/editor/tsconfig.json`'s include misses `scripts/build-frontend.ts` (the
  tooling digest's set-difference find). Harmless post-collapse: the gate is the root
  project, which covers it, and IDE service falls through to the root project too.
  Recorded, deliberately not fixed — the package tsconfigs are IDE scoping only now.

## Promotion

The tooling-session digest (scaffolding, archived at this seal) held two corrections to
live registers, promoted in the seal commit: the fragility entry's clause-4 mechanism
("GPU fixtures depend on shared process state") is refuted by single-file repro and its
clause-3 fallback gap grew 2→6 files; the isolate-hardening work item's "completes the
suite in 8.25 s" was false (69% of cases gate — 487 skip, 532 never run) and now states
the honest population plus the leverage order. Backlog entries deleted as resolved:
`testing-and-quality/root-scripts-have-no-typecheck-lane.md`,
`infrastructure/build-cycle-gate-cost.md` (typecheck strand landed here; suite strand is
the isolate-hardening work item; smoke tier stays dissolved).

## Orphans and growth

No exports orphaned — the five deleted `typecheck` script entries' only consumer was the
root fan-out deleted in the same commit. No file grew disproportionately: the slice is
−115 lines net, and its largest-grown file was the work item this seal tombstones.
