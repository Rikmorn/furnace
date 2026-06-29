# Dungeon: connectors don't stitch/blend the joined geometries (no connection algorithm)

**Context.** Slice 2.2.4 built the connection *primitive* as **placement + a floor bridge**:
`connect.ts join` rigidly positions a piece so its door **Connection point** coincides with a
target portal (positions meet, facings negate — it moves whole pieces, never touches their
surfaces), and `route` emits a flat **floor slab** (or ramp/stairs) spanning the two portal
positions, overlapping each by `SEAM_OVERLAP` (~0.6 m). There is **no algorithm that connects
the two geometries** — nothing carves matching portal openings through both surfaces, generates
a transition sleeve that meets each surface, or blends them.

So a cave→room join is an **organic cave bore** (a tunnel carved in the cave's Surface-Nets
isosurface) and a **box-room doorway** (a gap in a cuboid wall) — two independently generated
openings sitting near each other, bridged only by a floor. Since `buildArea` now places the
room `ROOM_GAP` (2.5 m) out from the mouth (2.2.4 changed this from room-at-mouth), you walk a
floor strip with **void/fog visible on the sides and above** — the connection reads as open and
unfinished. The same applies to the authored chamber→wing seam (box chamber ↔ organic cave).

**This is faithful to 2.2.4's spec** (the primitive was scoped to *placement + a walkable
connector*, NOT surface stitching) and **collision/walkability is unaffected** — the floor
slab + voxel/cuboid colliders work; the player walks the seam cleanly. The gap is purely
**render / geometry continuity**: heterogeneous procedural pieces aren't joined into a
continuous surface.

**Trigger to revisit.** When the generated world graph lands (2.2.5+) and/or a dedicated
visual-polish pass on connections — the world graph will multiply these heterogeneous joins, so
a real connection algorithm becomes load-bearing for the world reading as one continuous space
rather than placed pieces.

**Options to revisit (pick when scoping the work):**
- **Carve matching portals.** At the join plane, carve/open a matching aperture through both
  pieces' surfaces (the cave field + the box wall) so a single continuous opening spans them.
  For the cave side this means feeding the connector's mouth back into the field/mesher; for the
  box side, sizing the doorway to the connector.
- **Transition sleeve mesh.** Generate a short tube/sleeve connector mesh (not just a floor)
  whose two ends are shaped to meet each neighbour — the cave-end rim fit to the isosurface, the
  room-end rim fit to the box doorframe — so the passage is visually continuous. This is the
  "enclose the corridor" idea, but with end-caps shaped to each neighbour rather than a bare box.
- **CSG / boolean.** Union the corridor volume into both pieces and re-mesh the result, so the
  surfaces genuinely merge (heaviest; needs a robust mesh boolean).
- **Interim cosmetic stopgap** (only if a visual gate needs it before the real fix): shrink
  `ROOM_GAP`/`WING_SEAM_GAP` toward 0 so rooms sit ~at the mouth (the pre-2.2.4 tight look),
  and/or give the corridor side walls + a ceiling. Both hide the open seam without truly
  connecting the geometries — explicitly a stopgap, not the algorithm.

**Reference.** `packages/dungeon/src/connect.ts` (`join`/`placePiece`/`route` +
`buildConnectorLocal` — floor-only output), `packages/dungeon/src/compose.ts` (`buildArea`
`ROOM_GAP`, `attachWing` `WING_SEAM_GAP`). Surfaced at the Slice 2.2.4 visual gate (2026-06-29).
