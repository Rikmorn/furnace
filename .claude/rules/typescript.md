---
paths:
  - "**/*.ts"
---

Never bypass the compiler (`as Type`, `!`, `// @ts-ignore`, `// @ts-expect-error`, `// biome-ignore`). If the types don't work, fix the types -- don't silence them.

Exceptions, narrowly scoped:

- **Test files passing deliberately invalid inputs.** No comment required — the test's intent is the documentation.
- **Boundary casts at a real system edge** where the type system cannot track an invariant the runtime guarantees. Requires an inline `// Boundary cast: ...` comment naming the boundary and the invariant. Examples in this repo: DOM `Event.button` (number) narrowing to a domain `PointerButton` union; reading back module-private fields installed on a Context's `_internal` (the same module wrote them, the type system can't carry that fact across the public `InternalState` shape). "I needed to silence the compiler" is not a boundary; "the data crosses an external system whose types are wider than ours" is.

A type assertion to attach a phantom brand (`as unknown as BrandedType`) is **not** a boundary case — it disables structural verification of the factory's own output. If you find yourself reaching for it, drop the brand and use the structural type directly. A real `Symbol()` is the right tool when unforgeability is actually load-bearing, which is rare.

Narrow `unknown` in catch blocks -- never assume the shape of an error. Use `instanceof Error` before accessing `.message` or `.stack`. For domain errors, chain checks: `instanceof TokenBudgetExhaustedError` before `instanceof Error`.

Never use `{}`, `Object`, or `Function` as types -- they erase type information and are effectively `any`. Use `Record<string, unknown>` for genuinely unknown objects, specific function signatures instead of `Function`, and proper interfaces for known shapes.

Don't use optional chaining (`?.`) to paper over nullability. If a value can be null, handle it explicitly with an early return, a guard, or a default -- don't chain past it and hope for the best.

Prefer `const` over `let`. `let` should signal intentional reassignment across statements, not be the default. 
