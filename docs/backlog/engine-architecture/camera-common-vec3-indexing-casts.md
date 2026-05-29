# `camera/common.ts` uses `as number` casts on `Vec3` indexing

> **ENGINE-SIDE RESOLVED in A-6 (2026-05-29).** The `transform/*` + `camera`
> hot-path indexing casts (~263 sites) are a **recognised intentional-bypass
> class**, documented once in `.claude/rules/typescript.md` (no per-site
> comment needed). The fix-option-1 `vec3Get` runtime-checked helper below is
> **rejected**: it predates A-4's hot-path failure-policy stance (2026-05-28)
> and would add per-call validation to functions the convention forbids from
> validating. See `docs/superpowers/specs/2026-05-29-a6-audit.md` §5.1.
>
> **Remaining (out of A-6's six-module scope):**
> 1. **Consumer mirror** — `packages/cookbook/src/demos/animation/entry.ts:51-53`
>    (`cubePos[0] as number`) is the same pattern in demo code. Give it a
>    `// Boundary cast:` comment or fold under the same class note when a
>    cookbook hygiene pass next touches that file.
> 2. **Optional scope-off mechanism** — a per-directory `tsconfig` flipping
>    `noUncheckedIndexedAccess: false` for `transform/` would delete the casts
>    at zero runtime cost. Not adopted (keeps one strictness config). **Trigger
>    to revisit:** if the cast volume becomes a maintenance irritant, or a
>    `noUncheckedIndexedAccess` config review happens for another reason.

*Original entry (Tranche A-3 candidate, typescript hygiene) below — retained for context.*

`packages/core/src/camera/common.ts` has 8 sites where `Vec3` / `Float32Array` indexing is read as `number` via explicit casts:

```ts
position[0] as number
position[1] as number
position[2] as number
// ...8 sites across setPosition, setTarget, setUp, and helpers
```

Under `noUncheckedIndexedAccess` (enabled in this project), `Float32Array` indexing returns `number | undefined`. The casts bypass that — they assert "this index is in-bounds; trust me" without runtime evidence or compiler proof.

Per `.claude/rules/typescript.md`: *"Never bypass the compiler (`as Type`, `!`, `// @ts-ignore`, `// @ts-expect-error`, `// biome-ignore`). If the types don't work, fix the types — don't silence them."*

The boundary-cast exception doesn't apply here. The data isn't crossing a system edge; the types just don't express "this `Vec3` has length 3" structurally. This is a typed-array ergonomics gap, not a boundary.

This is pre-existing (predates Tranche A-1; was not introduced by the TSDoc work). Surfaced during T6 (camera TSDoc) when the implementer noticed the casts while reading the file.

## Fix options

Two viable shapes; pick during the tranche brainstorm:

1. **Inline `assert` with comment.** Add a small `vec3Get(v: Vec3, i: 0 | 1 | 2): number` helper that returns the element with a runtime check (or uses `v[i] ?? 0` for runtime-quiet behaviour). Replace each cast site with a call. ~8 lines of replacement, zero casts, runtime check costs ~3 ns per call (negligible at camera-setup scale).

2. **Type-level helper.** Introduce a `Vec3Tuple = readonly [number, number, number]` companion type and a `toTuple(v: Vec3): Vec3Tuple` boundary helper. Code that wants compile-time-known indices uses the tuple form. Heavier; more surface area; only worth it if more code than just `camera/common.ts` has this shape.

Strong preference for option 1 — single file affected, no API surface growth, addresses the violation directly.

Other modules to audit during the fix: grep `as number` across `packages/core/src/` to find any other instances of the same anti-pattern. The transform module's hot-path math (`vec3.ts`, `mat4.ts`, etc.) likely also has this pattern; if so, decide whether the math primitives stay as-is (justified by hot-path performance + the math primitive itself IS the boundary) or follow the same cleanup.

Consumer-side mirror: `packages/cookbook/src/demos/animation/entry.ts:51-53` also uses `cubePos[0] as number` etc. for `Vec3` element access inside the `positionLabel` helper. Surfaced 2026-05-28 during Resource Manager Stage 2 migration code-quality review. Same anti-pattern, different file — should be addressed by the same fix wave.

## What to verify when fixing

- Zero `as number` casts in `camera/common.ts`.
- `bun run typecheck` PASS (no new errors from removing the casts).
- `bun test` PASS — no behavioural change.
- Audit pass: `grep -rn "as number" packages/core/src/` reviewed and any non-boundary cases either fixed or explicitly justified inline.
- If a `vec3Get` helper is introduced, it's documented per the TSDoc convention.

**Trigger to revisit:** Next engine API hygiene tranche (A-3), OR before the next TypeScript hygiene audit, OR if a `noUncheckedIndexedAccess` upgrade reveals more sites.

**Reference:** Surfaced during Tranche A-1 (T6 camera TSDoc), 2026-05-26. Pre-existing — predates the tranche.
