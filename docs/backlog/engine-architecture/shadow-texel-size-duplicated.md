---
summary: the shadow texel size is a hardcoded literal in two WGSL fragments because WGSL cannot import the canonical TS constant, and single-sourcing it crosses the `shader/`-to-`frame/` layer boundary
---

# Single-source the shadow-map texel size across WGSL sites

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

The shadow-map texel size — `1.0 / 2048.0`, the reciprocal of `SHADOW_MAP_SIZE` —
is **hardcoded as a literal in two WGSL sites**, each carrying a comment that ties
it back to the TS constant:

- `packages/core/src/shader/shadows.ts` (`fr_shadowFactor`) — `let texel = 1.0 / 2048.0;`
  (commented `2048 = SHADOW_MAP_SIZE`).
- `packages/core/src/shader/lighting.ts` (`fr_shade`) — the normal-offset bias uses
  `* (1.0 / 2048.0)` (commented `2048 = SHADOW_MAP_SIZE`).

The canonical value lives in TS as `SHADOW_MAP_SIZE` (`frame/shadow-map.ts`), but
**WGSL can't import a TS constant**, so the texel size is duplicated as a literal in
both shader fragments. If `SHADOW_MAP_SIZE` ever changes, three places must move in
lockstep (the TS const + both WGSL literals) with nothing to catch a missed one.

A single-source fix exists — inject the value via `source` string interpolation
(`${1 / SHADOW_MAP_SIZE}`) so the WGSL is generated from the TS const — **but that
crosses the `shader/` → `frame/` layer boundary** (the shader fragments would need
to import `SHADOW_MAP_SIZE` from `frame/shadow-map.ts`, or have it injected by a
frame-layer assembler). That layering question is a real design decision, not a
mechanical edit, which is why it's deferred rather than done inline.

**Trigger to revisit:** making `SHADOW_MAP_SIZE` **configurable** (the literals
become wrong the moment resolution is a knob — see
`shadow-resolution-and-pcf-knobs.md`), OR a deliberate decision to
single-source the value regardless. Resolve the shader→frame layering question
first.

**Reference:** `packages/core/src/shader/shadows.ts` (`fr_shadowFactor` texel
literal); `packages/core/src/shader/lighting.ts` (`fr_shade` normal-offset literal);
`packages/core/src/frame/shadow-map.ts` (`SHADOW_MAP_SIZE`, the canonical const);
`shadow-resolution-and-pcf-knobs.md` (configurability is the likely trigger).
