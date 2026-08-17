---
summary: the `Light` union is three punctual types; area lights need an LTC shading subsystem and IES luminaires need a profile parser plus a per-light goniometric texture
---

# Area lights + IES (photometric) lights — beyond punctual directional/point/spot

Stage 3 Phase 2's `Light` union is **three punctual types** — `directional`,
`point`, `spot` (see `packages/core/src/frame/lights.ts`). Each radiates from a
point (or infinitely far, for directional) with an analytic falloff. Two
physically-richer light categories are deferred:

- **Area lights** — light emitted from a *surface* (rect / disc / line / sphere)
  rather than a point. They give soft, size-dependent specular highlights and
  soft shadow penumbrae "for free" from the source's extent. The standard
  real-time approach is **LTC (linearly-transformed cosines)** for the analytic
  area-light BRDF integral — a genuine shading subsystem (LTC lookup tables +
  per-shape integration in the lit shader), not a new branch in the existing
  punctual loop.
- **IES / photometric lights** — real luminaire intensity distributions loaded
  from **IES profiles** (the goniometric `.ies` files lighting manufacturers
  publish), giving accurate real-world light shapes (the scalloped wall-wash of a
  downlight, etc.). Needs an IES parser + a per-light intensity texture (the
  goniometric distribution) sampled by direction in the shader.

Both extend the `Light` union with a new variant that carries extra data (area:
shape + extent; IES: a profile texture) and add a matching shading path —
materially more than the current punctual model, so deferred.

**Trigger to revisit:** photometric accuracy or soft-shadow / soft-highlight
needs (architectural-viz lighting, realistic luminaires) — extend the `Light`
union with the area and/or IES variant and the corresponding shading path.

**Reference:** the `Light` union in `packages/core/src/frame/lights.ts` (the
current punctual `directional | point | spot` types); the Visual Fidelity epic.
