---
summary: the field world lives in the host until the user saves, with no daemon-side copy, so a browser crash loses everything since the last `⌘S` — the periodic write is small and the recovery UX is the decision
---

# Autosave / crash recovery

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

**The field world lives in the host until the user saves it.** There is no daemon-side copy,
so a browser crash loses everything since the last `⌘S`. The `dirty` bit exists and the op log
is serialisable (`oplog.json` is already part of a saved world), so a periodic write of the
op log to a scratch path is a small mechanism — what makes it a decision is the recovery UX
(offer it? on what evidence that a crash happened? whose world does it belong to?).

**Trigger to revisit: the first lost session.** The user's own ruling — "not that big a deal… fine to
backlog".

**Reference:** the host's `dirty` bit and the serialisable op log (`oplog.json` is already part of a saved world) — the mechanism half; `docs/reference/editor-architecture.md` §16–§18 for everything the same sweep put in the adopt column.
