# `@furnace/core/animation` — Tier 2 module

Animation primitives: tweens, easing curves, keyframe sequences, eventually skeleton/bone systems for skinned meshes. Likely depends on `frame.fixedClock` for deterministic timing and on `transform` for matrix math. Distinct from `frame.fixedClock` itself — that provides the *clock*; this module provides *what to do with it*.

Open design questions to settle when this is brainstormed: whether animations are state objects (`anim.create()` + `anim.update(dt)`) or function-pipeline style (compose easing/curves into a value-producer per frame); how they hook into mesh transforms (push vs pull); how to compose multiple animations affecting the same target (blending, additive layers).

**Trigger to revisit:** First demo needing motion beyond per-frame manual updates — typically when a triangle needs to bounce, a UI element needs to fade in, or a mesh needs to follow a path.

**Reference:** Core architecture design § "Tier 2 modules".
