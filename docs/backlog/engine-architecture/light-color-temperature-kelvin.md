# Light color via color temperature (Kelvin) — authoring sugar

Stage 3 lights take a raw **linear RGB** `color: Vec3`. A common authoring convenience
in other engines is to specify a light's color as a **color temperature in Kelvin** (e.g. 3200K
tungsten, 5600K daylight, 6500K overcast) and convert to RGB internally — three.js
`Light` (via helpers), Unreal, Blender all offer it. It reads more naturally for physically-grounded
scene setup than hand-picking RGB.

**Why it's deferred (and not a capability gap):** this is pure **sugar over the existing
`color: Vec3`** — a `kelvinToRGB(k): Vec3` helper (Planckian-locus approximation → linear RGB) that
the consumer calls before setting `color`. It adds no engine state, no binding/shader change, and
nothing in the data model blocks it; a consumer can already compute the RGB themselves today. So it's
a nice-to-have helper, not a stage and not a blocker.

**Status note (2026-06-07):** the multi-light Blinn-Phong base (Visual Fidelity Stage 3 Phase 2) has
now LANDED — lights take a linear-RGB `color: Vec3Tuple` on a `directional | point | spot` union (see
`packages/core/src/frame/lights.ts`), and `cookbook/lighting` exists. Kelvin authoring remains pure
sugar over that `color`, *not* delivered by Phase 2; the trigger refines to "when extending the
`Light` union / its authoring surface".

**Trigger to revisit:** a demo or consumer wanting temperature-based light authoring, OR if it would
make the `cookbook/lighting` demo's controls read better (a Kelvin slider instead of an RGB picker).
If added, ship it as a small pure helper (e.g. `light.kelvin(k)` → `Vec3` or a `color` convenience),
not as new light-data surface.

**Reference:** `packages/core/src/frame/lights.ts` (`Light.color` = linear RGB);
the Visual Fidelity epic Stage 3.
