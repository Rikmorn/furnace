# `_createShader` — collapse 7 positional params into an internal options object

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

Stage 4 added `usesShadows` as a third trailing boolean to `_createShader`
(`packages/core/src/shader/shader.ts`), which now reads:

```ts
_createShader(ctx, wgsl, engineOwned, layout, textureBinding, usesScene, usesShadows)
```

— **7 positional params, the last three of them booleans** (`textureBinding`,
`usesScene`, `usesShadows`). This is the classic clean-code "too many params /
boolean-flag arguments" smell: call sites are positional `…, false, true, true)`
runs that are unreadable without checking the signature, and each new shader
capability adds another trailing flag.

The fix is an **internal** options object — `_createShader` is engine-private (the
`_` prefix), so this is a pure refactor with no public-API impact:

```ts
_createShader(ctx, wgsl, { engineOwned, layout, textureBinding, usesScene, usesShadows })
```

Deferred for Stage 4 to keep the shadow change minimal and reviewable; the smell is
real but the three-boolean tail is just barely tolerable today.

**Trigger to revisit:** a 4th flag (or any new param) lands on `_createShader` —
refactor to the options object at that point rather than adding a 4th boolean.

**Reference:** `packages/core/src/shader/shader.ts` (`_createShader`).
