---
summary: the other arrow — the editor itself calling a model over a selection, and the provider-location, key-management and context-packaging decisions that needs
---

# Outbound — the editor calls an LLM ("make this material look wet")

**Re-filed 2026-08-10 at foundations T4c Task 7**, out of
`editor-ai-integration-milestone.md` item 4, which deleted at T4c close with items 1 and 2
delivered and item 3 dropped. This is the one of the donor's four shapes that T4 did not
consume and did not supersede, so it gets its own file rather than dying with the register.
Nothing below is new thinking; it is the donor's substance with a trigger that can actually
fire.

## Context

**The direction is the opposite of everything T4 built.** T4a→T4c made the editor
*drivable*: an outside agent claims nothing, reads a live session through a relay, and
writes through validated batched ops. All of it is INBOUND — the daemon answers, the agent
decides. This entry is the other arrow: the editor itself holds an API key, composes a
prompt, and asks a model for something. That is a product feature with a UX surface, not a
transport.

The motivating class is authored intent over a selection — *"make this material look wet"*,
*"scatter these props like a rockfall"*, *"describe what is wrong with this room"* — where
the human is in the chrome and the model is a tool they reach for, one result at a time.

**Four things it needs, and only the fourth is cheap now:**

1. **Provider integration.** A model call from the CHROME or from the DAEMON, and that is
   the first real decision — the chrome has the world and the daemon has the filesystem and
   the process environment. A browser-side call ships the key to the browser; a daemon-side
   call means the daemon composes a prompt about a world it cannot read (every fact but the
   project root and the worlds on disk lives in the other bundle —
   `docs/reference/editor/daemon.md`), so it would have to ask the tab for its
   context over the backchannel and then call out. The backchannel makes the second shape
   possible for the first time; it did not exist when this was filed.
2. **Key management.** Where a key lives, who may read it, and what the editor does with no
   key configured. The daemon reads `furnace.editor.*` config today
   (`src/daemon/config.ts`); a secret is a different class of thing from a port number and
   should not join it without a decision. Note the daemon serves loopback only and refuses a
   non-loopback `Origin` (T4a, §2) — necessary and nowhere near sufficient for holding a
   credential.
3. **Context packaging.** The donor's list, and every item on it now exists where it did
   not: the current document (the field artifact + the op log), the selection (core's
   replayable `SelectionSpec`, which `session.query`'s selection arm already projects),
   introspected schemas (`toJsonSchema` over the action rows and over generator
   `paramSchema`, both live at T4c), and **a capture** (`viewport.capture`, shipped at T4c
   Task 2 — an engine-side render that borrows the live viewport's own composition). So the
   packaging problem shrank from "build four things" to "choose what to send and pay for the
   tokens".
4. **Human review of proposed mutations.** The one clause T4 makes nearly free: a proposal
   is a `BrushOpInput[]` and `FieldHost.applyOps` lands a batch as ONE undo entry
   (`src/field-host/field-mutation.ts`). So "show me what you would do, let me accept or
   ⌘Z it" is a preview surface over a seam that already exists, not new mutation machinery.
   The stamp session's ghost is the precedent for the preview half.

**What it is NOT.** Not AI *generation* of assets (textures, meshes, audio) — that is the
fenced-out Rust asset-pipeline backend. Not runtime AI (NPC planning, TTS), which is
`docs/backlog/ai-agents/llm-as-planner-experiments.md`. Not the inbound MCP door, which is
built and whose as-built is `docs/reference/editor/agent-door.md`.

**Why it did not ride T4.** T4's whole thesis is that furnace exposes a substrate an agent
drives; the agent, its model, its keys and its budget are the CALLER's. Outbound inverts
that and makes furnace a model client, which is a product commitment about cost, latency,
provider churn and offline behaviour that nothing has yet asked for. The donor said it was
"entangled with M5's chrome"; M5's chrome is gone and F4.5's overlay cockpit replaced it, so
the entanglement is real but the surface it entangles with is different.

## Trigger to revisit

The donor's trigger was *"appetite after M5 lands"* — M5 is gone, so that clause can no
longer fire and is not carried forward. Two that can:

- **A specific authored-intent feature is wanted by name**, with the human in the chrome and
  the model as the tool — the "make this material look wet" moment arriving as a real ask
  rather than as an example. That is the honest trigger: this is a product feature and it
  should be pulled by a want, not pushed by capability.
- **OR the T4c/T5 agent walks show the INBOUND loop losing to the round trip** — i.e. the
  human is copying context out of the editor and pasting results back often enough that the
  editor holding the conversation would be cheaper than the human relaying it. That is
  measurable at the gate walks rather than arguable.

Explicitly NOT a trigger: the capture, the schemas or the query existing. Those removed the
plumbing excuse; they are not a reason.

## Reference

- `docs/reference/editor/agent-door.md` — the inbound half, as built; `docs/learnings/seals/2026-08-11-foundations-t4c-verbs-eyes-gate.md`
  for what T4c closed.
- `packages/editor/src/field-host/field-mutation.ts` — `applyOps`, the one-undo-entry seam a
  reviewed proposal would land through.
- `packages/editor/src/field-host/field-capture.ts` — the capture a prompt would carry.
- `packages/editor/src/daemon/config.ts` — the config surface a key would or would not join.
- `docs/backlog/ai-agents/llm-as-planner-experiments.md` — runtime AI, deliberately separate.
- `docs/research/2026-05-25-ai-asset-authoring/` — the donor's own research pointer, kept
  because it is the only place the asset-generation boundary is argued.
