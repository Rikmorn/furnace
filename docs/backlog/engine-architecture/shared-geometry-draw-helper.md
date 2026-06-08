# Shared `_recordGeometryDraw` helper — extract on the 3rd draw site

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

The indexed/non-indexed draw-dispatch branch is now duplicated in **two** sites:

```ts
if (indexBuffer && indexFormat) pass.drawIndexed(indexCount);
else pass.draw(vertexCount);
```

- `packages/core/src/frame/render.ts` — `recordDraw` (the main scene pass).
- `packages/core/src/frame/shadow-map.ts` — `_recordShadowPasses` (the depth-only
  caster pass).

Both bind the same geometry vertex/index buffers and choose `drawIndexed` vs `draw`
identically. This is the **2nd occurrence** — tolerable under "duplication until the
3rd consumer." The two copies are small but conceptually one operation ("dispatch a
draw for this geometry"), so they should converge once a third site exists.

**Trigger to revisit:** a **3rd** draw site lands (depth-prepass, picking pass,
wireframe, instanced batch). Extract `_recordGeometryDraw(pass, geometry)` that
takes the geometry's buffer/format/count and encapsulates the indexed/non-indexed
branch, and have all three sites call it.

**Reference:** `packages/core/src/frame/render.ts` (`recordDraw`);
`packages/core/src/frame/shadow-map.ts` (`_recordShadowPasses`).
