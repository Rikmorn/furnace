---
summary: a consumer-facing authoring surface where post effects are wired as a DAG with branches and reusable sub-graphs — a tooling layer on top of the runtime chain, not a capability gap
---

# Consumer-facing node-graph post editor

Deferred out of the Visual Fidelity epic, whose Stage 2
builds the runtime **multi-pass post chain** (a linear, pluggable ping-pong chain
of fullscreen passes) and ships tonemap + bloom. That runtime engine is distinct
from a **consumer-facing node-graph editor** — an authoring surface where effects
are wired as a DAG with branches, named taps, and reusable sub-graphs.

`multi-pass-post-effects.md` mentions a small internal "graph evaluator" for the
runtime; this entry is the *editor/authoring* concern on top, which is a separate
(and heavier) tooling problem. Keeping the runtime chain linear-and-pluggable in
Stage 2 means new effects are "one fragment shader + a chain entry" without this
editor — so this is a convenience/tooling layer, not a capability gap.

**Trigger to revisit:** when consumers need to compose post effects with branching
/ shared intermediates that a linear chain can't express, or when post authoring
moves into a visual editor (likely the editor-and-tooling track).

**Reference:** `multi-pass-post-effects.md`.
