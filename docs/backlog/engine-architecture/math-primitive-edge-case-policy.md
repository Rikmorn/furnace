# Math primitive edge-case policy is ad-hoc

*Tranche A-3 candidate (engine API hygiene — math conventions).*

`@furnace/core/transform`'s namespaced math primitives (`vec3.*`, `quat.*`, `mat4.*`) handle edge cases inconsistently and silently. Surfaced during Tranche A-1 (T15 transform TSDoc) — the TSDoc now documents the actual per-function behaviour, but the behaviour itself is ad-hoc.

## Specific instances

### `vec3.transformMat4` operator-precedence quirk

`packages/core/src/transform/vec3.ts:124` (roughly):

```ts
const w = m3 * x + m7 * y + m11 * z + m15 || 1;
```

Parses as `(m3*x + m7*y + m11*z + m15) || 1` because `+` binds tighter than `||`. The intent is "if w is zero, use 1 to avoid divide-by-zero." That works for *exactly zero* but does not catch "w near zero" (e.g. `w = 1e-12` produces a huge divisor); also easy to misread on a quick scan.

### `quat.normalize` returns zero quaternion on zero input

When `|a| === 0`, returns `(0, 0, 0, 0)` rather than identity `(0, 0, 0, 1)`. A subsequent `quat.multiply` with the zero quaternion produces `NaN`; `mat4.fromQuat` with a zero quaternion produces a degenerate matrix. Documented in TSDoc; consumer-burden to guard.

Most gl-matrix-family libraries either return identity (defensive) or are explicit caller's-problem (return as-is). Our current choice falls between.

### `mat4.rotate` silently no-ops on tiny axis

When `|axis| < 1e-6`, returns `m` unchanged. Documented in TSDoc; the threshold is hard-coded.

### `vec3.normalize` returns zero vector on zero input

Same family as `quat.normalize`. Documented; consumer-burden.

## The pattern

Each math primitive picks its own behaviour for degenerate inputs (no-op, zero, fall-through, divide-anyway). There's no engine-conventions section codifying the policy. Future math additions (e.g. `mat3.invert`, `vec3.reflect`, `quat.lookAt`) will face the same decision with no guidance — and we'll get a fourth pattern.

## Fix shape (design discussion needed)

Decide a convention before adding more math primitives. Three candidate policies:

1. **Runtime-quiet identity fallback.** Degenerate inputs return the identity element for the operation (`normalize → zero stays zero` becomes `normalize → input unchanged`; `mat4.rotate → identity`). Predictable; no NaN poisoning. May hide bugs.

2. **Setup-loud throw.** All math primitives `throw new FurnaceError` on degenerate inputs. Loud; defensive; punishes hot-path math (every `normalize` call eats a finite-check). Inconsistent with the rest of the math API's no-throw stance.

3. **Runtime-quiet silent fallback (current ad-hoc).** Keep per-function decisions but codify them in a single `engine-conventions.md §"Math primitive edge cases"` section so the policy is at least *documented* even if not uniform. Lowest churn; clearest for future additions.

Strong opinion: option 3 (codify) is probably right. Math primitives are hot-path; option 1 is the closest principled alternative if uniformity matters more than performance. Option 2 is wrong (throwing from math primitives bleeds into every render frame).

Also worth parenthesising the `vec3.transformMat4` line during this work — the `|| 1` precedence is correct but easy to misread. `(... + m15) || 1` is two characters and removes the trap entirely.

## What to verify when fixing

- `docs/reference/engine-conventions.md` grows a "Math primitive edge cases" section (or equivalent) listing per-operation fallback policy.
- Every public math function's TSDoc references the new convention section rather than restating per-function.
- If option 1 (uniformity) is chosen: cookbook consumers don't see behavioural regressions.
- `vec3.transformMat4` operator precedence is either parenthesised or annotated inline.
- Audit any other math files (`mat3.ts` doesn't exist yet but is reserved) for the same patterns.

**Trigger to revisit:** Next engine API hygiene tranche (A-3), OR before the next math primitive is added (so the policy is decided rather than another ad-hoc fallback inherited from gl-matrix-style code).

**Reference:** Surfaced during Tranche A-1 (T15 transform TSDoc), 2026-05-26. Per-function behaviour now documented in `vec3.ts`, `quat.ts`, `mat4.ts` TSDoc blocks.
