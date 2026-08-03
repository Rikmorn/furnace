# Seal log — chronological slice/epic seals (append-only)

Extracted VERBATIM from `AGENTS.md`'s per-package bullets on 2026-07-06 (post-Slice-3.1
hygiene): the bullets had grown to ~50 KB of history loaded into every agent session.
AGENTS.md now carries CURRENT-STATE summaries + pointers; the full chronological record
lives here and future slice seals APPEND here (a dated `##` section per seal), with
AGENTS.md getting only its current-state delta. As-built architecture is distilled in
`docs/reference/` (`dungeon-architecture.md`, `editor-architecture.md`, `core-modules.md`).

