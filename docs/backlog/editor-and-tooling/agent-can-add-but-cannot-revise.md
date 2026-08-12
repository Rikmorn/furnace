# An agent can add to a world but cannot revise one

**Context.** Measured 2026-08-11 during the first agent world-building probe, from both
sides — behaviourally over the live MCP door, and confirmed in the chrome's own source.
An agent can `generate` entities and `edit_apply` brush ops all day. It cannot delete an
entity it created, cannot re-aim its own view, and cannot say where the player starts.
The four gaps are one shape: **the door grew a read half (T4b) and a write half (T4c),
and never grew a revise half.**

**1. `edit.delete` cannot act on the id it is handed.**
`frontend/lib/actions.ts` gates it `enabled: (ctx) => ctx.selectedEntity !== null &&
ctx.session === null`, and its own comment says so: *"THE ONE ENTITY VERB THAT CANNOT
ACT ON AN UNSELECTED ID"*. The `entityId` input is a **confirmation guard**, not a
selector — the confirm prompt names the generator and counts the ops, and both come off
`ctx.selectedEntity`. A caller naming an unselected id is refused with *"select stamp #N
first"*. The source names the fix location itself: *"(T4's projection is where a
host-side lookup would change this.)"* — written before T4, still open after it.

**2. An agent cannot select an entity.** Selection is a left-click (`session_state`
reports `armed.does: "selectEntity"`), and the door has no click verb. `edit.reselect`
restores the *cell* selection, not the entity. So (1) has no workaround.

**3. `edit.grab` is the near-miss.** It opens a reconfigure session on a named entity —
`session: {generator, phase: "ready", mode: "reconfigure", entityId}` — while
`selectedEntity` stays `null`. But no tool feeds params into a live session, and
`generate` is refused while one is open. The mechanism that would solve this is
**visible to an agent and unusable by one.** Closing either half (let `generate`
retarget an open reconfigure session, or let `edit.delete` do a host-side lookup on the
id) would have turned a dead end into a two-call fix.

**4. The camera and the spawn.** `viewport_capture` takes `{view, size, overlays}` and
no target; its six axis views reuse *the human's* pivot and distance, and the only
viewpoint-moving verbs are `view.frame` (needs a selection) and `view.frameWorld`. Brush
ops mint no entity, so anything hand-carved can never be framed or photographed
deliberately. And `playerStart` bakes from the editor camera's eye
(`exportArtifact` in `field-host/field-world.ts`) — **measured: a re-bake silently re-rolled
the spawn from wherever the camera happened to sit**, twice in one session. That is not only an
agent gap; every re-bake re-rolls the spawn for a human too. It compounds: the
walkability advisor seeds reachability and pit detection from `playerStart`
(`analyzerSeeds` in `field-host/field-analyzer.ts`), so a spawn outside the build degrades the
habitability analysis as well.

**The mitigation is already queued, and it is the gating dependency.** The reason a wider
write surface has been held back is recoverability, and undo is the answer — but
`edit.undo`/`edit.redo` are refused for every agent because the op log carries no
per-op attribution, so stepping it would discard whatever is on top, routinely the
human's own stroke. **Undo + attribution is item (3) of the queue ruled at the
foundations T5 close.** So agent revision freedom is not blocked on wanting it; it is
blocked on attribution, which is already scheduled. Sequence them together rather than
separately.

**2026-08-12 — demand evidence from cycle 2, and one NEW mechanism.** Sculpting-worlds cycle
2's E1 monastery run reproduced §4 (camera and spawn) exactly — the bake wrote `playerStart`
27 m up and 22 m north of anything built, inside solid rock, which vacated the whole
reachability analysis. It also found a second reason §1 is unreachable: even with a correctly
typed object, `edit.delete {entityId}` refuses because it confirms against the SELECTED stamp,
and no agent verb selects an entity — so entity deletion stays dead even once
`action-run-input-is-schema-untyped.md` is fixed.

**The new finding is about ambition, not hygiene.** The door tells a caller *"to reverse
something you just did, apply the inverse ops explicitly."* That is true for `fill`. **It is
false for `dig`** — the destroyed material class cannot be restored, so an agent's mistakes are
permanent. The measured consequence: carves were sized **conservatively all session** because
none could be taken back. Attribution is the known blocker, and this is the argument that it is
load-bearing for how AMBITIOUS an agent will be, not only for history hygiene — a timid builder
is a worse failure than a messy undo stack, and nothing in the queue said so before this run.
Per the owner's cycle-2 ruling this files NO new entry; it attaches here, as demand evidence on
the queue item that already owns the fix.

**Trigger to revisit:** the undo + attribution wire-format design pass — this entry is
its consumer-side requirements list. Sooner if an agent build again dead-ends on a
mistake it can see and cannot correct.

**Reference:** `packages/editor/src/frontend/lib/actions.ts` (`edit.delete` gate and
run body); `packages/editor/src/shared/wire.ts` (`ViewportCaptureRequest`);
`packages/editor/src/field-host/field-world.ts` (`exportArtifact` — spawn from camera eye);
`packages/editor/src/field-host/field-analyzer.ts` (`analyzerSeeds` — reachability seeds).
Sibling: `docs/backlog/engine-architecture/stamps-not-authored-to-connect.md`.
