# Sphere built-in geometry

`geometry.cube` and `geometry.plane` ship in tranche 4. Sphere is the natural third primitive but its construction is non-trivial: latitude/longitude tessellation, UV seam handling, parameterized vertex count.

Likely shape: `geometry.sphere(ctx, opts?: { radius?: number; latitudeBands?: number; longitudeBands?: number })`. Defaults: radius 0.5, 24×16 bands (1024 vertices, ≈4500 triangles). Standard UV unwrap with polar singularities.

Open design questions:
- Icosphere subdivision vs latitude/longitude. Icosphere has more uniform triangle area but trickier UV; lat/long is standard.
- Default tessellation density — coarse (visible facets) vs smooth (default).
- UV seam: a single mesh has a seam where U wraps from 1.0 back to 0.0; either accept the seam artifact or duplicate the seam-side vertices.

**Trigger to revisit:** First demo wanting a sphere — particle billboards via single quad, planet/celestial demos, ball physics.

**Reference:** Tranche-4 design § Out (`docs/superpowers/specs/2026-05-23-core-tranche-4-drawable-primitives-design.md`).
