# Organic cave interior floor undulates > STEP_HEIGHT off-axis (trips the launch guard)

**Context.** The W2 collar+bore premise probe (`tests/collar-bore.gpu.test.ts`) walks the
player capsule hall → carved opening → bore → cave. The carve-into-built-grid seam (the new
composition this slice adds) walks clean on every lane, on-axis walks the full depth into the
cave clean, and the reverse lane walks clean. But an off-axis (±0.55 m) lane walking into the
organic cave (`HALL_CAVE`'s cave-b, seed `t:c`) hits a single-frame ~0.80 m rise — a
double-`STEP_HEIGHT` step-up that trips the traversal harness's `MAX_FRAME_RISE` (0.55 m)
ghost-launch guard, then a sustained Y-sawtooth (step-up → highest-support sweep perches high →
down-ray misses → falls → repeat).

**It is the CAVE's organic floor, not the collar-bore seam — VERIFIED by diagnostic.** A no-throw
diagnostic drive measured, for the SAME loaded HALL_CAVE world:
- full +0.55 hall-walk → 0.80 m rise AT the mouth (along 8.2);
- **capsule spawned IN the bore 3 m before the mouth, +0.55, walking in → crosses the mouth CLEAN
  (max 0.40 m), the 0.80 m bump appears only ~6 m deeper in the cave (along 14);**
- on-axis full hall-walk → max 0.40 m (at the carve seam step-up onto the bore floor), clean
  through the whole cave;
- bore-spawn −0.55 → 0.80 m bump deep in the cave (along 11.7), a DIFFERENT depth.
So the 0.80 m spikes are organic-cave-INTERIOR floor undulations, hit at variable depth on BOTH
±0.55 sides depending on the approach — not a wedge at the bore↔cave mouth (which crosses clean
from a bore-spawn) and not the carve seam. The collar-bore's bore is literally `organicTunnel`;
the cave floor bumps belong to the cave (seed `t:c`), which happens to undulate more off-axis than
the two-cave world's seeds did (whose ±0.55 wall-hug lanes passed in `world-traversal.gpu.test.ts`
while `DEFAULT_WORLD` was still two caves + a tunnel). NOTE (W2 Task 14): `DEFAULT_WORLD` is now
the GATE WORLD, and `world-traversal.gpu.test.ts`'s lanes are ALL ON-AXIS precisely because of
this entry — the off-axis cave-interior evidence now lives in `collar-bore.gpu.test.ts` (whose
off-centre lanes stop short of the mouth for the same reason). The retired two-cave world survives
as the `TWO_CAVES` fixture in `tests/_helpers/world-fixtures.ts`.
Earlier attribution attempts were confounded — a two-cave organic-tunnel control measured the
WRONG cave's mouth, and a "0.40 vs 0.80 via connector type" comparison was confounded by the
derived cave orientation; the bore-spawn isolation above is the clean measurement.

**Mechanism (the tracked class).** `CharacterMover.resolve` meets an organic floor step > 0.4 m,
horizontal progress stalls, it raises by `STEP_HEIGHT` and retries; `applyGravity` rests the body
on the highest support under the footprint (the intentional rim-riding / no-pocket-sink sweep),
perching it high; the down-ray finds no walkable ground and it falls — repeating. This is the
tracked voxel-proxy-KCC-on-organic-terrain class (2.2.1 shapecast-ground rim-riding; the
Jolt-CharacterVirtual proof). It is a property of the voxel-proxy KCC on organic terrain, not a
substrate/connector/carve defect.

**Why it doesn't block W2.** The slice premise (carve-into-built-grid seam walks) holds; the
committed gate walk (Task 14) is on-axis (hall → stairs → hall, hall → bore → cave), which walks
clean the full depth. Only off-axis lanes deep into this particular cave's organic interior bite.

**Trigger to revisit.** The Jolt physics-backend epic (field → marching-cubes mesh →
collide-on-Jolt `CharacterVirtual`, `EnhancedInternalEdgeRemoval`) — the tracked replacement for
the voxel-proxy KCC and the general fix for organic-terrain rim-riding. Raise priority if a
shipped world's on-axis or lightly-off-axis path rim-rides an organic cave in play.

**Reference.** `packages/dungeon/src/char-move.ts` (`applyGravity` highest-support sweep);
`packages/dungeon/tests/collar-bore.gpu.test.ts` (off-centre lanes scoped to the collar+bore
seam); the bore-spawn diagnostic above; the collision-architecture decision + Jolt-in-browser
proof. Surfaced + verified in W2 Task 11.
