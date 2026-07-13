# `assertDisjointRegionVolumes` is AABB-conservative and will reject legal worlds in the editor

**Context:** Surfaced in the W3 holistic review. W3 added `assertDisjointRegionVolumes`
(`packages/dungeon/src/world-build.ts`), which runs at realize and throws setup-loud when two PLACED
region AABBs interpenetrate on all three axes beyond dust (`REGION_OVERLAP_EPS` = 1e-6). Flush contact
is legal by design (an aperture pair shares exactly a plane); connectors are exempt (they
interpenetrate regions on purpose).

The check is AABB-level, and its TSDoc says so — this is not hidden. But AABB-level is CONSERVATIVE for
the field-organic class: a cave's `bounds` is a blobby whole-grid bounding box that is mostly air (the
93–96% figure `RegionData.envelopes` was introduced for), so a cave's box can interpenetrate a hall's
box while the actual rock surfaces never come near each other. The check will therefore reject some
GEOMETRICALLY VALID layouts.

That is a fine trade for hand-authored specs: `DEFAULT_WORLD` is a committed artifact, a false reject is
a loud error at bake time, and the author just moves a placement. It stops being a fine trade the moment
a HUMAN is dragging regions around: W3's other half is the World panel (editor), where region placement
becomes an interactive gesture. As it stands the editor will surface this as a hard error on a world the
user can see is fine, with an error message ("move a placement or shorten a connector") written for a
spec author, not for someone mid-drag.

Two candidate resolutions, and the editor tasks should PICK one rather than discover the failure mode:
(a) catch the throw at the editor's realize seam and present it as a non-blocking placement WARNING
(cheap; keeps the invariant honest for bake); or (b) tighten the check to test actual occupancy —
`RegionData.envelopes` already exists precisely because a cave's `bounds` over-claims, so a
`envelopes`-vs-`envelopes` test would reject only real interpenetration (more work; also makes the bake
bar less conservative, which needs a deliberate call).

**Trigger to revisit:** interactive region placement in the editor (dragging placements), OR the
field-charter brainstorm — one-field composition likely dissolves the check entirely
(docs/research/2026-07-13-one-field-direction.md §6). Until then it correctly guards hand-authored
bakes.

**Reference:** `packages/dungeon/src/world-build.ts` (`assertDisjointRegionVolumes`,
`REGION_OVERLAP_EPS`), `packages/dungeon/src/region.ts` (`RegionData.bounds` vs `RegionData.envelopes` —
the same over-claim problem, already solved once for the placement engine's Rule 1). Filed 2026-07-13
from the W3 review.
