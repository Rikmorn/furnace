---
summary: the depth-only caster pipeline reads the model matrix from an Object UBO bind group that `InstancedMesh` does not have, so instanced geometry is lit and receives shadows but casts none
---

# Instanced meshes don't cast shadows

## Context

Slice 2.2.3a added first-class GPU instancing to `@furnace/core` (`mesh.createInstanced` → an
`InstancedMesh` resource, instanced shader variants `shader.litInstanced` / `unlitInstanced`,
a separate `instanced?: InstancedMesh[]` render param on `frame.render` / `renderToTexture`).
Instanced meshes source their model matrix from a per-instance vertex buffer (`stepMode:
"instance"`, slot 1) and **bypass `@group(2)`**.

The depth-only shadow caster pass (`packages/core/src/frame/shadow-map.ts`) renders casters
through a pipeline that reads the per-object model matrix from an **Object UBO bind group**
(`casterObjectGroup` — **bind group 1** in the caster pipeline; group 0 is the light
view-projection) — which instanced meshes don't have (their model rides a per-instance vertex
buffer instead). So `_recordShadowPasses` explicitly `continue`s past any non-`"mesh"` draw —
**instanced meshes cast no shadows**: they are lit and can receive shadows, but they cast
none. For the dungeon's current scatter (small decorative props — rubble, fungus, crystals)
this is acceptable; the props are small and mostly self-shadowed / ambient-lit. (Note: on the
*main* render path the per-object Object UBO sits at `@group(2)`; the caster pipeline has its
own layout and rebinds it at group 1.)

Closing it needs an **instanced caster pipeline variant** — a depth-only pipeline that sources
the model matrix from the instance vertex buffer (slot 1) exactly like the visible
`*Instanced` variants do, plus a caster-pass branch that binds the instance buffer and issues
the instanced `drawIndexed(indexCount, count)` for each `InstancedMesh` flagged to cast.

## Trigger to revisit

When scattered decoration — or any instanced geometry — needs to **cast** shadows (e.g. large
instanced pillars / foliage / debris that should drop visible shadows, not just receive them).

## Reference

- `packages/core/src/frame/shadow-map.ts` — `_recordShadowPasses` (the caster pass that skips
  instanced meshes) + `casterObjectGroup` (the group-1 Object-UBO dependency).
- `packages/core/src/frame/render.ts` — the instanced draw path (the model-from-instance-buffer
  pattern to mirror in a caster variant).
- `packages/core/src/shader/builtins.ts` — `litInstanced` / `unlitInstanced` variants.
- Related: `per-mesh-shadow-optin.md`, `cascaded-and-point-shadows.md`.
