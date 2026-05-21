# Shader geometry cookbook (May 2026)

*Captured from a `/teach` session walking through the triangle-glow exercise in `packages/hello-world/src/triangle.wgsl` — going from a flat-colored triangle to an SDF-driven glowing shape (circle → square → triangle). The math is general WGSL/shader geometry; nothing here is furnace-specific.*

## The framing that made it click

Shader geometry is much smaller when read as a **kit of tools**, each tagged with a use case ("if I need X, reach for Y"), than when read as abstract math. Working graphics programmers carry ~30–50 of these recipes in their head. The job is rarely deriving math from first principles — it's recognizing which recipe fits the geometric problem in front of you and chaining a few together.

A `vec2` / `vec3` / `vec4` is just a tuple of floats. What it *means* (a point in space vs. a direction/displacement vs. a color vs. a texture coordinate) lives in the variable name and the programmer's head, not in the type. Operations behave geometrically based on what each operand represents:

| Operation | Result | Meaning |
|---|---|---|
| point − point | direction | "where do I have to go to get from A to B?" |
| point + direction | point | "move A by this displacement" |
| direction + direction | direction | "combine two displacements" |
| scalar × direction | direction | "scale the displacement" |
| point + point | (usually nonsense) | signal that something's mixed up |
| scalar × point | (usually nonsense) | depends on the origin; geometrically weak |

Convention in code: `p0`, `p1`, `p` for points; `e`, `v`, `d` for directions.

## The cookbook

| When you want to... | Reach for | Why it works |
|---|---|---|
| Get the **direction from A to B** | `B - A` | Point − point = direction |
| **Walk from A** by a direction `d` and land somewhere new | `A + d` | Point + direction = new point |
| Get the **distance between A and B** | `length(B - A)` or `distance(A, B)` | Direction's magnitude |
| Get the **midpoint** of A and B | `(A + B) * 0.5` | Average position |
| Get a **unit-length version** of a direction | `normalize(d)` | `d / length(d)` — same direction, length 1 |
| Make a direction **longer/shorter, same direction** | `d * scalar` | Scaling preserves direction |
| **Reverse a direction** | `-d` | Flips the arrow |
| Test if **two directions are aligned** | `dot(a, b)` | Positive = same way, 0 = perpendicular, negative = opposite |
| Find **how far along edge `e` a perpendicular from query point lands** | `dot(v, e) / dot(e, e)` (with `v = p - edge_start`) | Projection scalar — gives "fraction of `e`" |
| Test **which side of a line a point is on** (2D) | sign of `v.x * e.y - v.y * e.x` | 2D cross product — positive = one side, negative = the other |
| Get **distance from point `p` to a circle** at center `c`, radius `r` | `length(p - c) - r` | Distance to center, then offset by radius |
| **Smoothly blend** between two values by `t ∈ [0, 1]` | `mix(a, b, t)` | Linear interpolation |
| Make a **smooth threshold** (0 below, 1 above, smooth in between) | `smoothstep(edge0, edge1, x)` | Cubic falloff — for halos and soft edges |
| **Hard threshold** | `step(edge, x)` | 0 or 1, no curve — the un-smooth version of smoothstep |
| Extract just the **polarity** of a value | `sign(x)` | -1, 0, or +1 — used for inside/outside tests |
| **Constrain** a value into a range | `clamp(x, lo, hi)` | Vital for keeping projections on segments |

## Two patterns worth memorizing as whole moves

**Closest point on a segment to a query point:**

```wgsl
let closest = a + clamp(dot(p - a, b - a) / dot(b - a, b - a), 0.0, 1.0) * (b - a);
```

One tool, not three. Read as: "project the query onto the edge to get a fraction, clamp it to stay on the segment, walk along the edge by that amount."

**Smooth glow from any SDF:**

```wgsl
let intensity = 1.0 - smoothstep(0.0, halo_width, sdf);
let rgb       = mix(bg_color, glow_color, intensity);
```

Anytime you have an SDF (circle, box, triangle, anything), this turns it into a glow. The SDF describes the shape; this snippet describes the lighting.

## Composing into shapes — SDFs

A **signed distance field** is a function "for any point, how far am I from this shape's boundary?" — negative inside, positive outside. Useful because:

- Once you have the SDF for a shape, the glow recipe above gives you a halo for free.
- Subtracting a constant from any SDF "grows" the shape outward, rounding off sharp corners in the process (`box_sdf - 0.1` = rounded box).
- Combining SDFs with `min()` is "union" (draw both shapes); `max()` is "intersection"; `max(a, -b)` is "subtraction" (a with b cut out).

Canonical reference (GLSL but ports line-for-line to WGSL): https://iquilezles.org/articles/distfunctions2d/

## Reading dense formulas

Triangle SDF math is dense because it chains five recipes: subtract to get edges, project to find perpendicular feet, clamp to stay on segments, cross-product to test sides, sqrt at the end to convert squared distance to distance. None of the individual recipes are hard once tagged with their cookbook entry. The skill is recognising the chain.

When re-reading a dense formula, annotate each operation with its cookbook entry in your own words. The bits you can't comment cleanly are the bits to dig into next.

## Practising

Pencil-and-paper exercises build intuition faster than re-reading formulas. Pick small coordinates and walk through:

- If A = (1, 2) and B = (4, 6), what's `B - A`? Where does `A + (B - A) * 0.3` land?
- If `p = (2, 3)` and the segment goes from A = (0, 0) to B = (4, 0), what's the projection scalar `t`? Where does the foot of the perpendicular land?
- For a circle of radius 1 centered at origin, what's the SDF value at `(0.5, 0.5)`? At `(1, 0)`? At `(2, 0)`?

Half an hour of these builds more intuition than a dozen reads of any single formula.

## See also

- Canonical SDF reference: https://iquilezles.org/articles/distfunctions2d/
- WGSL spec built-in functions: https://www.w3.org/TR/WGSL/#builtin-functions
- WebGPU Fundamentals (very approachable tutorials): https://webgpufundamentals.org/
- `packages/hello-world/src/triangle.wgsl` — the file where the exercise lives in this repo.
