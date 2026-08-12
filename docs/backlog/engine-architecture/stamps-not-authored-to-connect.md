---
summary: generator doors are validated only within their own stamp, so nothing checks that two placed stamps' doorways actually meet
consumer: door-set
---

# Stamps are not authored to connect

**Context.** Three of the four field generators carry doors — `hall`, `maze` and
`cave` each declare `doorNorth/South/East/West` booleans plus a lateral offset per
wall. Each generator validates its doors **within its own stamp**: `openDoor`
carves the opening and `assertDoorOffsetFits` checks the approach lane is clear
(`DOOR_CLEARANCE_DEPTH_CELLS` inward × full door height must be AIR), which is the
cross-field rule the zod range cannot express. Nothing validates that two stamps
placed beside each other have doorways that actually **meet**.

Assembling a kit of parts into one circulation is the premise of building a world
from stamps, and today it is entirely the caller's arithmetic: match the shared
wall plane, match the floor height, and match the lateral offset — the last of
which is expressed in a **different unit per generator** (`hallOffset` maxes at 28
coarse cells of 0.5 m; `mazeOffset` maxes at 7 maze cells of 2.5 m pitch;
`caveOffset` maxes at 62). A caller can produce two rooms that read as connected
and are not, with no refusal, no flag, and no way to ask.

**Precedent fidelity.** Deep Rock Galactic's caves are not purely procedural: the
team hand-authored shapes and let the system arrange and randomise them
(https://store.steampowered.com/news/app/548430/view/4040248138382844738). That is
the same model as our stamps-arranged-by-a-caller, which is encouraging — but
their authored shapes carry the connection mechanism, and ours carry doors that
are decoration until somebody does the maths. Per working-standards §Planning, the
deviation is named rather than assumed harmless: we kept the precedent's shape and
dropped its load-bearing mechanism.

**Shape of the work** (options, not a decision):

- Doors become first-class **anchors** a caller can query on a committed entity —
  world-space position, facing, and clear width — so alignment stops being
  re-derived from params in three unit systems.
- A **check** rather than a primitive: something that answers "do these two
  entities' doorways meet", reported the way the placed-prop lint reports floating
  and overlapping props.
- A **placement helper** that snaps a new stamp to a named door on an existing
  entity, making the aligned case the easy one.

The three unit systems are themselves part of the gap: whatever lands should let a
caller speak in world metres at the seam, whatever the generator counts internally.

**2026-08-12 — THE TRIGGER FIRED, and the first option is now scheduled.** Sculpting-worlds
cycle 2's E1 run assembled two `hall` stamps plus a `cave` into one circulation of five places,
which is the "more than two stamps" case this trigger named. What it measured:

- **Doors are advertised as connections and carry no position.** Every generator has
  `doorNorth/South/East/West`, which reads as a connection affordance — but a door opens into
  solid rock and **you cannot ask where it is**. Worse for the cave: `buildMouths` sets the
  mouth's height from the nearest chamber's floor, so it is unknowable without reading
  `packages/core/src/field/cave.ts`. The run did read it, and only because that agent had
  filesystem access.
- **The entity answer is a bounding box, not structure.** `session_query {about:"entity"}`
  returned `min [12,0,4] max [44,16,28]` for the cave — a box that is ~90% rock. `buildChambers`
  had already computed exact centres, radii and floor heights and discarded them. **The
  generator knows; the door doesn't say.**
- **The three unit systems cost an entire expressive axis.** `doorNorthOffset` ranges to 28 on
  the hall, 7 on the maze and 62 on the cave, *in units the schema never states*. The run
  therefore avoided door offsets entirely — precisely the axis that would have let it AIM doors
  instead of hand-carving junctions. This is the paragraph above, priced.

The **first option** (doors as first-class queryable anchors) is what closes all three at once,
and the owner ruled at cycle 2's close that it joins the `door-set` E0-equivalent set. It has a
CORE half (the generators must stop discarding what they computed) and an editor half (the
entity arm must relay it) — noting the split here because cycle 2's ruling listed the item as
core-only.

**Trigger to revisit:** **`door-set` planning takes the door-anchor option as its E0-equivalent**
(owner, 2026-08-12). The original trigger — the first build that assembles more than two stamps
into a single circulation, including the agent world-building probes — has fired twice and is
kept as the record of what it predicted.

**Reference:** `packages/core/src/field/generators.ts` (`openDoor`,
`assertDoorOffsetFits`, `HALL_PARAMS` / `MAZE_PARAMS` door fields);
`packages/core/src/field/cave.ts` (`CAVE_PARAMS` door fields). Sibling entry
`cave-generator-topology-richness.md` covers richness *within* one cave; this one
is the seam *between* stamps.
