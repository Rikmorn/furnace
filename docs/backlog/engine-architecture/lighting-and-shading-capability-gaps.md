# Lighting and shading capability gaps

Tracker for what the shipped **Blinn-Phong forward** path does not cover. The Visual
Fidelity epic (2026-06-08) landed multi-light Blinn-Phong with punctual directional /
point / spot lights, textures, HDR post, and opt-in shadow maps; everything below is a
capability that path cannot express. Each section is one previously standalone entry with
its Context, *Trigger to revisit* and *Reference* preserved.

They are merged because they share both a subsystem (`frame`'s light packing +
`shader/lighting.ts`) and a family of triggers — *a demo whose look the punctual
Blinn-Phong model cannot reach*. Sections are ordered by how far each one departs from the
shipped model: the material model itself (PBR), then light kinds the model has no term for
(area/IES, cookies), then authoring and ambient sugar, then the scaling question
(many lights), then two narrower gaps on already-shipped surfaces (textured specular
params, fog modes).

## PBR material pipeline (metallic-roughness + IBL + normal mapping)

Deferred out of the Visual Fidelity epic, which ships a **Blinn-Phong**
reference shader instead. A physically-based
metallic-roughness pipeline is a cohesive follow-on epic, not a stage, because
"minimal PBR" is a misnomer: the Cook-Torrance BRDF itself (~30–50 lines WGSL) is
small, but to not look *worse* than Blinn-Phong it drags in two genuine subsystems:

- **IBL** — a prefiltered specular cubemap + irradiance map + a BRDF LUT
  (split-sum). PBR lit by analytic lights alone reads dark/flat with no ambient
  specular energy.
- **Normal mapping** — needs tangent-space, and furnace `GeometryData` carries
  only `positions/normals/uvs` (verified `geometry/types.ts`, 2026-06-05) — no
  tangent attribute. So this adds a vertex attribute (tangent generation across
  the primitive factories) + a TBN basis in the shader.

The lighting *enablement* built in the Visual Fidelity epic (light data resource,
multi-light buffer, shadow maps) is **BRDF-agnostic**, so swapping Blinn-Phong →
Cook-Torrance later is "a different reference shader against the same light
buffer," not a rewrite. This epic pairs naturally with — and should precede or
merge with — the glTF asset epic, since glTF **is** metallic-roughness PBR and
needs the same IBL + normal-map + tangent machinery.

**Trigger to revisit:** after the Visual Fidelity epic lands shadows, OR when the
glTF asset epic starts (whichever first) — glTF forces the same machinery.

**Reference:** `unbuilt-tier-2-modules.md` §glTF import (the glTF asset epic this pairs with).

## Area lights + IES (photometric) lights — beyond punctual directional/point/spot

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

## Light cookies / gels / gobos (projected-texture lights)

Stage 3 lighting ships per-light **uniform RGB color** on every light type (`Light.color: Vec3`,
linear), which covers "a red point light / a warm sun / a blue spot" via the `colorInt` lane of
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

**Reference:** `shadow-follow-ons.md` (*Advanced shadows* section) + the Stage-4 shadow-
modeling decision (shared light-space-projection machinery); the Visual Fidelity epic.

**Update (Stage 4, 2026-06-08):** Shadows landed, and with them the light-space-projection machinery
this entry needs now exists — `packages/core/src/frame/shadow-projection.ts` builds the per-light
view-projection matrix (ortho for directional, perspective for spot). The per-light-texture pattern
also resolved: `Light` stays plain per-frame value data, and the engine owns a per-frame
texture reference (the shadow array bound at `@group(0)` bindings 2/3 — see
`frame/render.ts` `ensurePerFrameGroup0`). Cookies/gels/gobos build directly on both: reuse the
shadow-projection matrix and add a projected texture per cookie-light alongside the depth array. The
trigger now refines to **extending the `Light` union with a projected texture** (rather than
modelling the projection from scratch).

## Light color via color temperature (Kelvin) — authoring sugar

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

## Spatially-varying ambient — environment volumes / light probes

Stage 3 Phase 2's `ambient` is a **per-frame consumer policy value**: a
`{ sky, ground, intensity }` hemisphere term passed via `RenderOptions.ambient`
(see `packages/core/src/frame/render.ts`) and packed once into the Scene UBO
header. It is **uniform across the whole scene** — every fragment reads the same
sky/ground colours regardless of world position. The consumer recomputes it per
frame (e.g. tinting it to time-of-day), but it has no spatial dimension.

Real scenes want **position-varying ambient**: a character walking from sunlit
outdoors into a red-lit interior should pick up the local indirect colour. The
engine-side answer is an **environment-volume / light-probe** feature — baked or
placed probes (irradiance volumes, SH probes, a probe grid) that the lit shader
samples by world position to get a local ambient/irradiance term, replacing the
single global hemisphere lookup. That is a cohesive subsystem (probe placement,
bake/capture, a probe buffer, shader sampling), not a tweak to the current
per-frame scalar — so it is deferred, not folded into the ambient value.

This also overlaps with the IBL machinery deferred for PBR (see
the *PBR material pipeline* section): an irradiance map is the simplest "one global probe"
form of this, and a probe grid generalises it.

**Trigger to revisit:** scenes need position-varying ambient (indoor/outdoor
transitions, locally-coloured indirect light) — design the probe/volume
representation alongside (or after) the IBL work.

**Reference:** `RenderOptions.ambient` in `packages/core/src/frame/render.ts`
(the current per-frame uniform hemisphere term); the *PBR material pipeline* section (the
IBL machinery this overlaps with).

## Many lights — clustered/tiled forward+ or deferred shading

### Context

The engine renders **forward** with a fixed `MAX_LIGHTS = 16` Scene-UBO array
(`packages/core/src/frame/lights.ts:150`; `_packScene` clamps to 16 and
`frame.render` warns once on overflow, never throws). This caps **simultaneous
real light sources at 16** regardless of scene size.

The dungeon (atmospheric crawler) wants *many* light-emitting elements —
scattered glowing crystals / fungi, lava or ember fields, multiple torches —
that **actually illuminate** their surroundings, not just bloom-glow visually.
Slice 2.2.3a ships emissive scatter as **unlit + bloom** (purely visual, no real
light) *precisely because* real scattered lights are impossible under the 16-cap.
Making many emitters cast real light needs a lighting architecture that
**decouples light count from a fixed forward UBO array**.

Ray tracing is out — there is no hardware-RT path in browser WebGPU. The two
realistic candidates (research pass needed before choosing):

- **Clustered / tiled forward+** — bucket lights into view-space clusters via a
  compute pass, then each fragment shades only its cluster's lights. Scales to
  thousands of lights while **keeping the forward path** — so it preserves MSAA
  (the dungeon renders `sampleCount: 4`) and transparency, and is the *least
  invasive* change to the existing forward + bloom→tonemap chain. Likely the
  better fit for furnace.
- **Deferred shading** — a G-buffer decouples lighting from geometry; the classic
  many-lights solution. But it **conflicts with MSAA** (the dungeon's
  `sampleCount: 4`) and transparency, costs more bandwidth, and is a larger
  rewrite of the forward render path. (This was the first instinct raised, but
  the MSAA conflict is the concrete reason to weigh clustered forward+ first.)

Both need WebGPU **compute + storage buffers** (light lists / cluster grids) —
mind the compatibility-mode vertex-stage storage limit noted in the 2.2.3a
instancing research (compute-stage storage is fine; this is a vertex-stage-only
quirk).

### Trigger to revisit

When the dungeon wants **> ~16 simultaneous real light sources** — i.e. when
"emissive glow via unlit + bloom" stops being atmospheric enough and scattered
emitters must genuinely pool light on nearby surfaces. Open with a cited research
pass (clustered forward+ vs deferred) before any implementation.

### Reference

- 2.2.3a brainstorm (emissive glow scatter — the trigger that surfaced this).
- `packages/core/src/frame/lights.ts:150` (`MAX_LIGHTS = 16`); forward render
  path `packages/core/src/frame/render.ts`.
- Related: the *PBR material pipeline* section, `shadow-follow-ons.md` (*Advanced shadows*
  section), the *Area lights + IES lights* section, `post-chain-follow-ons.md` (*runtime
  render-graph / FrameGraph (T3)* section).

## Per-material params on textured materials — specular now, PBR params later

`texturedLit` shades its sampled albedo with the same multi-light Blinn-Phong
model as `lit`, but its specular is a **fixed engine constant** — `FR_TL_SPEC =
vec3(0.04)` / `FR_TL_SHININESS = 32.0` baked into `TEXTURED_LIT_SRC`
(`packages/core/src/shader/builtins.ts`). `lit` carries per-material specular
because its `@group(1)` is a `{ color, specular }` uniform; `texturedLit` cannot,
because its `@group(1)` is **sampler + texture only**.

### The framing (decide this first — the shape follows)

The concrete trigger is "let a textured surface choose its own specular," but the
*real* question is broader and worth deciding deliberately:

> **Can a textured material carry an optional typed *material-params* uniform —
> of which `specular` is just the first field?**

Framed that way, this is **step one of "textured material + material params,"
i.e. the PBR direction** (albedo map alongside roughness / metallic / specular —
as uniforms now, maps later). The cheap version (a specular-only uniform) and the
general version (a params block) are the **same plumbing** — only the layout
schema differs. So the decision that matters isn't "add a specular uniform to
`texturedLit`"; it's whether to design the general "texture + params uniform"
capability so it **generalises to PBR** (see the *PBR material pipeline* section) instead
of being a one-off that gets reworked. Decide the framing when picked up; the
exact descriptor / API shape is deliberately left open until then.

### What's technically blocked (context, not a prescribed shape)

The blocker is the `texture ⊕ binding` exclusivity in `material.create`:
`MaterialDescriptor.texture` and `.binding`/`.bindings` are mutually-exclusive
`@group(1)` sources — exactly one fires (the "mutually exclusive `@group(1)`
sources" guard in `packages/core/src/material/material.ts`). A textured material's
`@group(1)` is consumed by `sampler@0 + texture@1`, leaving no slot for a params
uniform. Lifting it means letting `@group(1)` carry a texture AND a typed uniform
together (a `@binding(2)` uniform after sampler+texture). One wrinkle to remember
so it isn't mistaken for a one-liner: the typed `binding` path today assumes its
uniform sits at `@binding(0)`, so it needs a base-offset when a texture precedes
it — that offset coupling is what makes it a deliberate `material.create` change.
(`texturedLit` would also gain a real `layout` — it's `null` today.)

**Independent of Stage 4** (shadows don't touch material params) — a standalone
tranche that can land before or after shadows with no interaction.

**Trigger to revisit:** art needs per-surface specular / glossiness on textured
materials, OR the PBR material work begins — at which point design the *general*
texture + params-uniform capability, not a specular one-off.

**Reference:** `packages/core/src/shader/builtins.ts` (`TEXTURED_LIT_SRC` —
`FR_TL_SPEC` / `FR_TL_SHININESS`); `packages/core/src/material/material.ts` (the
`texture ⊕ binding`/`bindings` guard); the *PBR material pipeline* section (the
generalisation target this should feed, not pre-empt).

## Height-banded fog and additional fog modes

**Context:** Epic 1 ships exponential distance fog only — the `Fog` mechanism on
the Scene UBO `fog` lane (`mix(color, fog.rgb, 1 - exp(-density * dist))`). There
is no height-banded fog, no linear (start/end) fog, and no per-area fog authored
as scene data.

**Trigger to revisit:** When a scene needs height-banded fog (denser low to the
floor), linear start/end fog, or per-area fog authored as data rather than set
imperatively in the render call.

**Reference / design seam:** *(Restated at T5, 2026-08-11. The original paragraph
routed the data path through `settings.fog` → `LoadedScene.fog` →
`scene/loader.ts`, mirroring `settings.ambient`. None of those exist: foundations
T2 deleted `@furnace/core/scene` and with it the text-JSON document format, its
loader, and `LoadedScene`. There is no authored-scene-data seam to hang fog on any
more; the capability below is unchanged, only the seam is.)*

Fog is a **per-call render argument** now, not authored document data: the caller
passes a `Fog` (`{ color, density }`) into `frame.render`, which packs it into the
Scene UBO's single `fog` vec4 (rgb = color, a = density) — see
`packages/core/src/frame/lights.ts` (`Fog`, `_packScene`, and the unwritten-lane
contract that governs what happens when it is omitted). The shader side is
`fr_applyFog` in `packages/core/src/shader/lighting.ts`.

So the work has two parts, and the first one is now a question rather than a
given: **(1) where do additional fog params come from** — still a per-call
argument, a field-artifact setting, or something the world tier owns; and
**(2) how do they reach the shader** — either overloading the existing `fog` vec4
or adding a follow-on lane to the Scene UBO header, plus the matching branches in
`fr_applyFog`. Height-banded fog needs at least one more vec4 (band height,
falloff); linear fog needs start/end in place of density.
