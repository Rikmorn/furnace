# Docs authoring

Write-time rules for every tracked doc. Canon with rationale, schemas, and lifecycle:
`docs/reference/docs-system.md`. Checks: `scripts/check-docs.ts` (in `bun run check`).

"Checked." below means checked **in the live registers** — `docs/backlog/`,
`docs/reference/`, `docs/work/`. The rules bind every tracked doc; the scanner only reaches
those three, so everywhere else (`docs/learnings/`, `AGENTS.md`, `.claude/`, package
READMEs) they are yours to hold.

- **One record per file.** Never merge entries into tracker files; merged views are
  generated only. Directories shard by topic when crowded.
- **Backlog entries carry frontmatter:** `summary:` (one line, feeds the generated
  index), `status: open | deferred | superseded` (open = default), `superseded-by:` /
  `supersedes:` (both edges, one commit), `consumer: <slice-slug>` (charter inputs
  only — protects the entry from consolidation; the slug must name a LIVE `docs/work/`
  item, checked. If the consuming slice is not scheduled yet, use a prose trigger — the
  field means someone on the board reads this, not that someone should).
- **Never cite `file:line`.** Cite the symbol (`markUnreachable` in `field-analyzer.ts`).
  Checked.
- **Values rule.** A dated snapshot (seal, charter evidence) is immutable — keep it, with
  its deriving command beside it. A present-tense derivable value defaults to
  command-only: state the fact and how to derive it, not a number that rots. The rare
  inline value a reader needs wraps in a derive marker:
  `<!-- derive: <deterministic command> -->value<!-- /derive -->`. Checked.
- **Deliberate dead path** (recording a deletion): write it as `` `the/old/path.ts` (gone) ``.
  Unmarked dead paths are check failures.
- **Work items** live in `docs/work/`: epic = directory (record in its `README.md`),
  slice = file. Slice frontmatter: `status: queued | next | in-flight | blocked-on-owner`
  (≤1 item `next`), `summary:`, `injected: true` when scheduled ahead of an in-flight
  epic's remaining slices, optional `after: <slug>` for ruled order. Sealed slice → delete
  the file; the seal is the tombstone.
- **Scaffolding joins work by slug, never by path.** Name specs/plans/reports after the
  work-item slug (`specs/<date>-<slug>-design.md`). Tracked docs never cite
  `docs/superpowers/` paths.
- **Prose pins** (byte/word budgets on agent-paid prose) state their kind — budget
  (derived from consumer economics) or drift alarm (ratified size × slack) — plus basis
  and binding response, in the test that enforces them. A binding pin triggers
  re-derivation or re-review, never a silent bump.
- **Never state future conformance in the present tense.** A reference doc says how the
  project IS. A convention that is agreed but not yet applied is written "ratified; pending
  at `<slice>`", with the slice that carries it named. An undated "is" that means "will be"
  is rot at birth — the claims-side sibling of the values rule.
