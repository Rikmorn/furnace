# vec2 module for `@furnace/core/transform`

The `Vec2` type is exported from `transform/types.ts` (`Float32Array` of
length 2) but there is no `vec2.ts` module — no `vec2.create`, no
`vec2.fromValues`, no `vec2.copy`, no math helpers. The siblings (`vec3`,
`vec4`, `mat4`, `quat`) all have their respective modules.

## Discovered during

Tranche A-2 (orthographic fit policy, 2026-05-27). The fit policy needed an
anchor field; using `Vec2` would have required `new Float32Array([x, y])`
construction everywhere or shipping a vec2 module as part of A-2.
Sidestepped by introducing a plain-object `Anchor = { x: number; y: number }`
type for the policy variants — which is consistent with furnace's
configuration-data shape convention (`OrthographicBounds`,
`{ width, height }`). The `Vec2` type itself is still exported but no
factory or helpers exist for it.

## Trigger to revisit

First 2D-game consumer that needs screen-space helpers: cursor position
tracking, UV coordinate math, anchor lerping for smooth-following cameras,
collision AABBs in 2D, tile coords. Any of these would benefit from a
proper `vec2` module with the same shape as `vec3`.

## Reference

- `packages/core/src/transform/types.ts` (Vec2 type definition)
- `packages/core/src/transform/vec3.ts` (template for what vec2 would look like)
