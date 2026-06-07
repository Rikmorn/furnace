# Light cookies / gels / gobos (projected-texture lights)

Stage 3 lighting ships per-light **uniform RGB color** on every light type (`Light.color: Vec3`,
linear), which covers "a red point light / a warm sun / a blue spot" — see
`docs/superpowers/specs/2026-06-07-stage-3-lighting-design.md` §3.1/§3.4 and the `colorInt` lane of
the Scene UBO. What it does **not** cover is a *spatially-varying* colored light: a texture
**projected through** a light — a "cookie"/"gobo"/"gel" — e.g. stained-glass color through a
spotlight, a window-blinds pattern, a flashlight mask, dappled tree-shadow light. These modulate the
light's color/intensity per-fragment from the light's point of view, rather than per-light uniformly.

**Why it's deferred (not a Stage 3.5):** a cookie needs (1) a **light-space projection matrix**
(perspective for spot, ortho for directional) to map the fragment's world position into the light's
texture space, and (2) a **texture per cookie-light** sampled in the lit shader. That is materially
more than the punctual-light data model (it adds per-light GPU-texture association + a projection
matrix), and it overlaps directly with **Stage 4 shadow-map machinery** (shadow maps need the same
light-space projection). The natural time to add cookies is *with or after* shadows, reusing the
light-space-projection + per-light-texture infrastructure rather than building a parallel path now.

Modelling note: a cookie associates a **texture with a specific light**, which is the same
"per-light owns/references a GPU resource" question deferred for shadows (Stage 3 keeps `Light` as
plain data; see the Stage-4 shadow-modeling decision). Cookies and shadows likely share that
resolution (engine-owned atlas indexed by light slot, or a promoted light resource) — decide them
together.

**Status note (2026-06-07):** the multi-light Blinn-Phong base (Visual Fidelity Stage 3 Phase 2) has
now LANDED — `Light` is a `directional | point | spot` union with uniform per-light RGB color (see
`packages/core/src/frame/lights.ts`). Cookies remain a future, orthogonal extension *not* delivered
by Phase 2; the trigger refines to "when extending the `Light` union" (with the shadow infra).

**Trigger to revisit:** a concrete need for projected/patterned light color (stained glass, window
masks, flashlight gobos), OR when Stage-4 shadows land the light-space-projection + per-light-texture
infrastructure that cookies would reuse — whichever comes first. Build on that infra, not before it.

**Reference:** `docs/superpowers/specs/2026-06-07-stage-3-lighting-design.md` (§3.1 `Light` data
model, §3.4 shading, §5 fences); `advanced-shadows-cascades-and-point.md` + the Stage-4 shadow-
modeling decision (shared light-space-projection machinery); the Visual Fidelity epic.
