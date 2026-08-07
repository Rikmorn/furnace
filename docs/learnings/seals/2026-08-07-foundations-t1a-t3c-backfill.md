# Foundations program · T1a→T3c — consolidated backfill seal

- **Sealed:** 2026-08-07 — **a BACKFILL**, written at the T3c merge by user decision ("we
  have a process, follow it"): the program had run eight tranches against its own
  criterion 5 ("every tranche seals") with no seal written. One consolidated record now;
  per-tranche seals resume from T3d.
- **Package(s):** core, editor, dungeon (T2's retirement); tools untouched
- **Gate:** a standing review per tranche (one reviewer subagent: independent claim
  re-derivation, mandatory gates, sabotage re-runs restored byte-identical) + user Safari
  gates at T3b2 and T3c (2026-08-07, incl. the ⇧⌫ decision that had never been
  browser-driven)
- **Suite:** 2894 pass / 1 skip / 0 fail at T3b2 → **2912 / 1 / 0** at T3c

**The program** (spec: gitignored superpowers scaffolding — the tracked record is this
seal, the commits, and `docs/reference/editor-architecture.md` §20–§23) hardens core +
editor architecture ahead of T4 MCP and F5. Eight tranches, all merged FF to master:

- **T1a** (`5f80b7dc`) — tier enforcement + mesh-blob.
- **T1b** (`4197f807`) — `core/registry` + zod generator schemas.
- **T2** (`24f8d7f6`) — dungeon-v1 retirement + the whole scene system deleted, −24K
  lines; `@furnace/core/scene` gone, the daemon down to 8 commands / 3 SSE events.
- **doors** (`b79cd276`) — the surface-membership boundary clause (imports are judged by
  declared NAME, not path shape); `RATCHETED_EDGES` retired.
- **T3a** (`765ecd81`) — the host's framework primitives: `view-channel.ts` (13 seams),
  `input-router.ts` (Esc = capture-stack recency, 3 pinned behaviour changes),
  `substrate.ts`; core's `logApplyGroup`.
- **T3b1** (`2b958c5e`) — five cluster extractions (voidcast, props, stats, history-feed,
  view) + the `frontend/ → field-host/ → shared/` one-way layer chain, machine-enforced;
  ten chrome contexts → per-consumer latches; `viewport-host/` → `field-host/` rename.
- **T3b2** (`6fd98876`) — the action system data-first: one `shared/action-table.ts`
  (six derived tables, zero mismatches on the derive-and-diff gate), `src/action-registry/`
  (39 descriptors as data, 6 input schemas, the Node door), 39 actions on
  `Promise<ActionResult>` through one funnel; the ⇧ decision (`ShiftPolicy` deleted,
  ⇧⌫ deletes).
- **T3c** (branch `foundations-t3c` — 11 execution commits plus the review session's,
  merged FF at this seal) — the gesture
  machine: stamp + move + gesture left the closure as ONE module (`field-machine.ts`,
  1,936 lines — every boundary between the three cuts a state machine in half), the
  pointer chain's four handler bodies followed (`MachineDeps` 22→39, value-vs-call
  audited three times); `setStamp`/`setPendingMove` closed the canonical-setter law
  (one sanctioned Esc change: a sub-threshold press gained a rung); `createRung` unified
  seven rungs; `shared/tool-registry.ts` (existence + the one capability rule;
  `ToolDefinition.build` deferred whole on the two-bundle constraint);
  `FieldHost.commitSession` deleted — facade 66→65; `field-host.ts` 7,266 → 6,337.

**The honest miss, and its disposition.** T3's exit clause "field-host.ts is a facade"
**does not hold** at this seal: 2,854 code lines (~7.1× the ~400-line guideline), 14 of
23 cluster rows live, ~59 of ~71 mutation edges standing. The as-built docs say so
plainly (editor-architecture §23.7). The miss was a **planning gap** — the tranche plans
never summed to the exit clause — not an execution failure, and the user's ruling at the
T3c review (2026-08-07) is that the objective stands: **T3d is scheduled** to finish the
decomposition; T3 closes after it, with a programme objectives-audit report owed at that
close.

**Decisions of record along the way:** `txn`/`TransactionManager` DROPPED on measured
evidence (core's OpLog + `logApplyGroup` + derived labels ARE the transaction story);
segment's 2-D fix state-side only (presentation backlogged); the cluster map
(`field-host-clusters.md`) re-derived in full against head at the T3c review rather than
retired. The T3c gate surfaced one UX finding, filed not fixed:
`a-live-session-can-run-with-its-card-invisible.md`.

**Program lessons that should outlive it:** every audit count states its sweep scope
(re-derive guards caught bad premises in every tranche) · executor reports omit behaviour
changes the as-built docs record — reviewers must audit the docs diff · derive-and-diff
before consumer-switch (prove derived == literal while both exist) · a declarative table
may FORCE a product question but never answer it (⇧ / ShiftPolicy) · sabotage
requirements in plans fire for real · renders-clean tests cannot catch wrong-output —
state checks are not pixel checks, and the browser gate stays human.

Detail: `docs/reference/editor-architecture.md` §20–§23,
`docs/reference/field-host-clusters.md`, `packages/editor/README.md`, and the commits
named above.
