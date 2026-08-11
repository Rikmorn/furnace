# Cookbook debt

The cookbook's outstanding debt against the "one demo page per Tier 1 feature" convention.
The first and largest part is the T5 surface audit's finding — ten Tier-1 names with an
unrecorded no-demo state, below. Two earlier-filed debt entries of the same kind were
absorbed into this file at T5 (2026-08-11) and are the final section; they are debt against
the same convention, filed before the audit ran.

## Ten Tier-1 names with an UNRECORDED no-demo state

Filed 2026-08-11 by the foundations T5 core surface classification audit (T5 Task 7). It is
the constructive half of that audit: of 161 zero-consumer public names, **150 keep · 10
cookbook-debt · 1 delete**. These ten are the cookbook-debt class — Tier-1 capability with
no demo AND no recorded decision not to demo it. Nothing here is a deletion candidate; the
entry files the missing demo and the names stay.

### Context

`docs/reference/core-modules.md` maintains, per module, a `### Demoed in cookbook` list and
a `### Reference-only (no demo, by design)` register. The register is the repo's existing
per-name answer to "why no demo", and it **pre-empts** this class — a name already in it
(e.g. `texture.uvGrid`, "a diagnostic surface, not demoed") is a keep, because the decision
exists. A Tier-1 name absent from BOTH lists has an *unrecorded* no-demo state: the gap was
never decided, only never closed. Those are the ten below.

Checked at filing: none of the ten appears in any of the file's 15 `### Reference-only (no
demo, by design)` registers.

```
grep -c "^### Reference-only (no demo, by design)" docs/reference/core-modules.md   # → 15
```

Three clusters, two host demo pages. The minimum landing for each cluster is a new or
extended page under `packages/cookbook/src/demos/` **plus** moving the names into that
module's "Demoed in cookbook" list — or, if a future reader disagrees with the Tier-1 call,
into the module's `### Reference-only` register **with a reason**. Either landing is
acceptable; leaving the state unrecorded is what this class exists to stop.

#### 1. `physics` — the kinematic character controller (5 names)

`CharacterController`, `CharacterControllerOptions`, `createCharacterController`,
`computeMovement`, `destroyCharacterController`.

Kinematic character movement is the one thing a first-person consumer needs from a physics
module, and it is fully documented in `core-modules.md`'s `physics` Public table (every
`CharacterControllerOptions` field mapped to its Rapier setter, `computeMovement`'s
query-after-step ordering rule and its runtime-quiet policy). It appears in neither of that
module's two cookbook lists — the Demoed bullet names only `createWorld`/`step`/`createBody`/
`getBodyTranslation`/`getBodyRotation` via `rigid-mesh`, and the Reference-only register
holds only `createHeadlessPhysicsContext`/`PhysicsContext`.

Source: `packages/core/src/physics/character.ts`.
HOST: `packages/cookbook/src/demos/physics` — add a capsule the demo drives with
`computeMovement` over the colliders it already builds (a `cuboid` ground plus dynamic
cubes, all `rigidMesh.create`d), applied through `setBodyNextKinematicTranslation` before
the next `step`.

**Adjacent finding, surfaced by the same audit and NOT fixed there** (it needs a
classification decision, which is what keeps it out of the inline-fix threshold): these five
names are **absent from `docs/reference/api-posture.md` altogether** — the whole KCC family
is missing from §"Classification of the current surface", so it has no taxonomy placement at
all. `grep -n "Character" docs/reference/api-posture.md` returns nothing (verified
2026-08-11). The decision it needs: `CharacterController` is documented as "an opaque object
handle … a world-bounded helper, not a resource-pool handle", which is a kind the existing
Resource / Value-type split does not obviously hold. Whoever closes the demo half should
close this too, or split it out.

#### 2. `physics` — contact events (2 names)

`CollisionEvent`, `drainCollisions`.

The physics module's only event channel (contact begin/end). Same evidence shape as the KCC
cluster: classified in `api-posture.md` but in neither cookbook list.

Source: `packages/core/src/physics/world.ts`.
HOST: `packages/cookbook/src/demos/physics` — the demo already steps a world and draws
`getDebugLines`; draining contacts is one more readout on the same loop.

#### 3. `shader` — custom lit/shadow-receiving composition (3 names)

`sceneBinding`, `lightingHelpers`, `shadowHelpers`.

These sit INSIDE the `shader` module's "Demoed in cookbook" block, described as "**not yet**
cookbook-demoed" — a deferral written in the demo list, which is not the same act as a
by-design exemption in the Reference-only register. Composing a custom lit shader against
the engine's own Scene UBO and shadow maps is precisely the lesson `cookbook/shader` exists
to teach; `cookbook/shadows` exercises the *built-in* receive path (`shader.lit`) instead,
which teaches nothing about composition.

Source: `packages/core/src/shader/{scene-binding,lighting,shadows}.ts`.
HOST: `packages/cookbook/src/demos/shader` — a third shader arm composing `lightingHelpers`
with `shader.create(ctx, src, { usesScene: true, usesShadows: true })`. Note the trap worth
demoing explicitly: composing `lightingHelpers` pulls `shadowHelpers` in transitively, so
omitting `usesShadows` leaves `@group(0)` bindings 2/3 unbound and validation fails.

### Trigger to revisit

Three, whichever fires first:

1. **The next `packages/cookbook` session of any kind.** The work is bounded — two existing
   demo pages extended, no new page required — so it is cheap enough to ride any cookbook
   visit rather than waiting for a dedicated one.
2. **A change to any of the three source files named above** (`physics/character.ts`,
   `physics/world.ts`'s `drainCollisions`, `shader/{scene-binding,lighting,shadows}.ts`).
   That is the moment a demo would have caught the break, and it is checkable:
   `git log --oneline -1 -- packages/core/src/physics/character.ts` against this entry's date.
3. **A second `@furnace/core` consumer needing first-person movement.** The dungeon has its
   own `char-move.ts` built on `castShape` rather than the KCC, so today's only would-be
   consumer routed around this surface — which is itself worth a note in whichever landing
   this entry gets.

### Reference

- `docs/reference/core-modules.md` — the `@furnace/core/physics` and `@furnace/core/shader`
  sections; the per-module `### Demoed in cookbook` / `### Reference-only (no demo, by
  design)` pair is the record this entry exists to complete.
- `docs/reference/api-posture.md` — where the collision-event pair (Value-type row,
  Core-mutator row) and the three shader fragments (Value-type row) are classified. The five
  KCC names are NOT there; see the adjacent finding under cluster 1.
- `packages/cookbook/README.md` — the one-demo-per-Tier-1-feature convention.
- `packages/core/src/physics/character.ts`, `packages/core/src/physics/world.ts`,
  `packages/core/src/shader/{scene-binding,lighting,shadows}.ts`.
- Sibling debt of the same shape, filed earlier: the *Diagnostics demo* section below.

## Earlier-filed cookbook debt (absorbed at T5, 2026-08-11)

Two entries that predate the audit above and are debt against the same convention. Both
keep their Context, *Trigger to revisit* and *Reference* as written; only their heading
level changed.

### Cookbook demo for diagnostics (log sink + GPU emitters)

Tranche C shipped `@furnace/core/log` (formal sink) and the typed GPU diagnostic emitters (`onUncapturedError`, `onDeviceLost`) but explicitly deferred the cookbook demo to keep the Tranche C scope bounded. The cookbook convention is "every public surface demoed" — this is a debt entry.

**Shape (sketch):** a single-page cookbook demo that:

1. Installs a custom log sink that appends formatted entries to a DOM overlay (`<pre>` element scrolling), alongside the default `consoleSink` for DevTools visibility.
2. Subscribes to `gpu.onUncapturedError(ctx, fn)` and `gpu.onDeviceLost(ctx, fn)` and writes the events into the same overlay.
3. Includes a button that deliberately triggers an uncaptured error (e.g. by creating an invalid pipeline) so the user can see the diagnostic appear in real time.
4. Teaches the sink-composition pattern (`setSink(e => { consoleSink(e); domSink(e); })`).

**Reference:** `packages/cookbook/src/post/` is the closest existing demo shape (single-page setup + dispose); the diagnostics demo can borrow the page structure.

**Trigger to revisit:** Next cookbook session, OR when a consumer (outside hello-world) asks how to integrate furnace diagnostics with their telemetry. Whichever comes first.

### Cookbook: broader `normalColor` → `lit` sweep

**Filed 2026-06-04** (Stage 4A — "Playable Core"). Stage 4A added the `shader.lit` built-in and swapped the cookbook **animation** demo to it (Task 10). The other cookbook demos still default to `shader.normalColor` — this entry tracks the optional follow-up sweep.

#### Context

`shader.lit` (half-Lambert directional + hemisphere ambient, reusing `unlit`'s `{ color: "vec4f" }` `@group(1)` layout) reads form/motion more legibly than `normalColor`'s rainbow-normal debug shading for demos whose lesson is NOT about normals. Stage 4A swapped only the `animation` demo (its lesson is interpolation, and stable directional lighting reads rotation better).

Other cookbook demos still using `normalColor` (verify the current set before sweeping; ~6 at filing time, e.g. geometry/primitives, camera, render-target where colour isn't the lesson). Each candidate swap is the Task-10 pattern:
- `shader.lit(ctx)` REQUIRES a colour binding (`binding.create` + `binding.set({ color })`) — `material.create` throws on a layout-bearing shader with no binding. The bare shader-swap is NOT sufficient (this bit Task 10).
- Use a MID-TONE colour — `lit`'s combined directional+hemisphere term peaks ~1.6×, so bright/near-white base colours clip and lose the shading gradient.
- Track + destroy the binding for leak-free teardown if the demo destroys its material (the binding owns its buffer; `material.destroy` does not free it).

**Not a blanket swap:** `normalColor` is KEPT as the debug shader. Demos whose lesson IS normals/debugging should stay on it. The `shader` demo is a `shader.load` showcase, not a normalColor showcase — out of scope. Only swap demos where lit genuinely reads better and loses no teaching value.

#### Trigger to revisit

A cookbook-polish pass, OR when a specific demo's legibility is observed to suffer under `normalColor` (faces indistinguishable, rotation invisible). Low priority — purely cosmetic/teaching-clarity, no functional gap.

#### Reference

- Pattern: `packages/cookbook/src/demos/animation/entry.ts` (the Task-10 swap), `packages/cookbook/src/demos/blend/entry.ts` `createUnlit` (the binding pattern)
- API: `docs/reference/core-modules.md` `@furnace/core/shader` (`lit`), `@furnace/core/binding`
