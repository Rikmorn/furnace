# Shadow-map resolution + PCF kernel — make them configurable

Stage 4 (shadows) ships with both the shadow-map resolution and the PCF softening
kernel **fixed**:

- **Resolution** — every shadow layer is `2048²` texels, hardcoded as
  `SHADOW_MAP_SIZE` in `packages/core/src/frame/shadow-map.ts`. No consumer knob
  to raise it (sharper, more memory) or lower it (cheaper, blockier).
- **PCF kernel** — the comparison-sampler filter is a fixed **3×3** tap pattern in
  `packages/core/src/shader/shadows.ts` (`fr_shadowFactor`). No knob for a wider
  (softer, more expensive) or narrower / single-tap (hard-edged, cheapest) filter.

Both are scope-to-current-need: `2048²` + 3×3 PCF look good on the Stage 4 bowling
scene at the demo's draw distance. The natural exposure shape is a per-light or
per-config field (resolution per shadow-casting light, kernel as an enum / tap
count), additive to the current fixed substrate — no rework of the depth pass or
the sampler required.

**Trigger to revisit:** a scene where `2048²` looks low-res (large directional
coverage — note CSM is the other answer there, see
`advanced-shadows-cascades-and-point.md`), OR a consumer wanting softer shadows
(wider PCF) or cheaper ones (single-tap) than the fixed 3×3 delivers.

**Reference:** `packages/core/src/frame/shadow-map.ts` (`SHADOW_MAP_SIZE`);
`packages/core/src/shader/shadows.ts` (`fr_shadowFactor`, the 3×3 PCF tap);
`advanced-shadows-cascades-and-point.md` (CSM is the answer for large-frustum
resolution, distinct from raising a single map's size).
