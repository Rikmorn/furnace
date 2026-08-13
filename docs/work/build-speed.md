---
status: in-flight
injected: true
summary: collapse typecheck to one incremental root lane, close the coverage gap, docs-only gate convention — the scoped-gate script overruled
---

# Build-cycle speed

The gate is slow enough to change behaviour — it gets skipped, and skipped gates stop being
gates.

**Re-derived 2026-08-13 at slice take** (dated snapshots; deriving command beside each):

- typecheck: **22.9 s** across the five lanes (`time bun run typecheck`) vs **6.6 s** for a
  single root-project run (`time bunx tsc --noEmit -p tsconfig.json`). Verified from source
  that the root project is a strict superset: the three package tsconfigs that exist are
  `extends` + `include` with no `compilerOptions`, and the hello-world/dungeon lanes have no
  tsconfig at all, so they resolve the root config — the whole-repo check runs twice.
- `--incremental` probe (procedure: append a one-line edit to the named file, `time bun run
  typecheck`, revert): warm no-change **2.0 s**, warm leaf-package edit **2.1 s**
  (`packages/dungeon/src/editor-extensions.ts`), warm core edit **7.0 s**
  (`packages/core/src/errors.ts`; ≈ cold — core is the import-graph root).
- suite: **56.8 s** (`time bun test`; 3,292 pass / 1 skip, 376 files) — out of this slice's
  scope; `isolate-hardening` owns it (`--parallel` measured 8.25 s there).

**Shape (revised at take, 2026-08-13 — three pieces):**

1. **Typecheck = one incremental root lane.** Delete the five per-package `typecheck`
   scripts; root `typecheck` becomes a single root-project `tsc` with `--incremental`.
   Exclude gitignored scaffolding (`docs/superpowers`, plugin `pkg` outputs) so the gate's
   file set stops being clone-dependent. Closes the root-`scripts/` coverage gap for free.
2. **Docs-only gate convention** — one line in AGENTS.md §Before committing: docs-only
   commits gate on `bun run check` alone.
3. **Register pass** — DONE 2026-08-13: `testing-and-quality/root-scripts-have-no-typecheck-lane.md`
   (gone — the root lane is now the gate) and `infrastructure/build-cycle-gate-cost.md`
   (gone — typecheck strand landed here; the suite strand is the `isolate-hardening`
   work item); AGENTS.md `typecheck` command wording updated with the collapse commit.

**Ruling reversed (owner, 2026-08-13):** the tooling session's "scoped gates by dep graph —
the ruling wants a script" is **overruled**: "doesn't earn it." With the config fixes above
plus `isolate-hardening` landed, the full warm gate projects to roughly 12–17 s, where
selection logic saves ~10 s at best and costs a changed-files→blast-radius mapping that can
lie in the under-gating direction. Revisit trigger: if `isolate-hardening` hits a wall and
the suite stays ~57 s serial, a scoped gate becomes worth pricing again.
