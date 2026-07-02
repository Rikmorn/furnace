# Dungeon: a descending connector can clip its lower endpoint's door lintel

**Context.** Slice 2.2.5a's `layoutWorld`/`occupancy.ts` clearance model exempts a connector's
reserved walking-air from its own endpoint pieces' solids only within a **portal exemption**
box (`layout.ts` `portalExemption` — `PORTAL_EXEMPT_DEPTH`/`PORTAL_EXEMPT_PAD`/
`PORTAL_EXEMPT_BELOW` around the portal, reaching `headroom + PORTAL_EXEMPT_PAD` above the
portal floor). A **descending** connector's clearance volume arrives at its lower endpoint
**above** that room's floor (it climbs down INTO the room from height), so the volume can clip
the room's door lintel/ceiling above the doorway — the portal exemption's reach doesn't cover
that geometry unless the door spans the connector's full headroom. An **ascending** connector
never hits this: it approaches its high endpoint from below, so its clearance volume sits
entirely below that portal's own headroom line.

Slice 2.2.5a's proof graph (`world.ts`) hit exactly this on the `upperA → landing` descending
stair-run: `landing`'s seat door (`LANDING_SEAT_DOOR`) had to be built **full-height** (height 5,
spanning the whole wall with no lintel) purely so the descending clearance volume's headroom
wouldn't clip a normal door's ceiling. This is a **workaround baked into the hand-authored
graph**, not a general fix in the placement engine.

**Trigger to revisit.** Slice 2.2.5b's *generated* graphs — a generator that emits a
normal-height room at the bottom of a generated descent (rather than a hand-tuned full-height
seat) will reproduce this clip, and nothing in `layoutWorld` currently prevents it. Options to
consider then:
- Auto-detect a descending edge at graph-build or placement time and force-seat a full-height
  door on the lower endpoint (mirrors today's manual `landing` workaround, made automatic).
- Extend the descending portal's exemption box specifically (not the ascending case) to reach
  higher above the portal floor, covering a normal door's lintel band.
- Have `route`/`layoutWorld` reject (or auto-widen) a descending seam whose target door height
  is less than the connector's arrival headroom, rather than relying on the caller to build a
  tall-enough door.

**Reference.** `packages/dungeon/src/layout.ts` (`portalExemption`, `clearanceBoxes` — the
climb-following segmented clearance volume), `packages/dungeon/src/world.ts`
(`LANDING_SEAT_DOOR` — the full-height workaround). Surfaced + verified during the Slice 2.2.5a
proof-graph build (2026-07-02).
