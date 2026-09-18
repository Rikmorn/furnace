---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# sk-* TypeScript

Assumes `tsconfig.json` has `strict: true` and `noFallthroughCasesInSwitch: true`. If either is off, re-enable it rather than working around.

## Don't bypass the compiler

Never bypass the compiler (`as Type`, `!`, `// @ts-ignore`, `// @ts-expect-error`, or the linter's suppression comment). If the types don't work, fix the types — don't silence them. The only exception is test files deliberately passing invalid inputs.

Never use `{}`, `Object`, or `Function` as types — they erase type information and are effectively `any`. Use `Record<string, unknown>` for genuinely unknown objects, specific function signatures instead of `Function`, and proper interfaces for known shapes.

Narrow `unknown` in catch blocks — never assume the shape of an error. Use `instanceof Error` before accessing `.message` or `.stack`. For domain errors, chain checks: `instanceof DomainError` before `instanceof Error`.

Don't use optional chaining (`?.`) to paper over nullability. If a value can be null, handle it explicitly with an early return, a guard, or a default — don't chain past it and hope for the best.

## Parse at boundaries

External data is `unknown` until parsed. API responses, `searchParams`, `localStorage`, `postMessage` payloads, URL params, form submissions, and webhook bodies all enter the program as `unknown`. Narrow them through a runtime schema (Zod / Valibot) before use — don't trust shapes you didn't check.

Types are inferred from schemas, not duplicated. `type Order = z.infer<typeof OrderSchema>` over a parallel `interface Order` declaration. The schema is the source of truth; when it changes, the type follows automatically.

Name type guards when they're reused. `function isOrder(v: unknown): v is Order { ... }` documents the shape check once and keeps narrowing logic in one place. Inline guards are fine for single-use.

## Model with discriminated unions

For variants and states, use discriminated unions, not optional fields on a single interface. `type AsyncState<T> = { status: "loading" } | { status: "success"; data: T } | { status: "error"; error: Error }` enables narrowing via the `status` field; a single interface with `data?: T` and `error?: Error` does not.

Force exhaustiveness with `never`. In `switch` statements over a discriminated union, add a `default` case: `const _exhaustive: never = state; throw new Error("Unhandled state")`. When the union gains a new variant, the compiler rejects every switch that doesn't handle it.

Use `as const` for literal unions, not `enum`. Enums compile to runtime JavaScript, have confusing bidirectional key/value semantics, and block tree-shaking. Prefer `const Reason = { Damaged: "damaged", WrongItem: "wrong_item" } as const; type Reason = (typeof Reason)[keyof typeof Reason]`, or a plain string union if iteration isn't needed.

## Idiomatic code

Prefer `const` over `let`. `let` should signal intentional reassignment across statements, not be the default. Two patterns to refactor: `let result` outside a `for` loop that accumulates is a `reduce`/`map`/`filter` in disguise — the loop is rewriting the same variable, which is what `reduce` does. `let x` outside a `try/catch` to assign from inside should be a function returning the value (or an IIFE). Loop counters (`for (let i = 0; ...)`) are exempt. If reassignment is genuinely the simplest option, `let` is fine — but be honest about whether that's the case.

Use `??` (nullish coalescing), not `||`, when defaulting a potentially nullish value. `||` treats `0`, `''`, and `false` as falsy — a real bug source for numeric and boolean fields. `??` only triggers on `null` and `undefined`.

Use `satisfies` for config-like const objects. It validates structure against a type *without* widening the inferred literal types. `const config = { ... } satisfies ConfigShape` keeps narrow inference (useful for lookups and discriminant checks) while catching shape errors; `const config: ConfigShape = { ... }` widens and loses that precision.

Let inference handle internals; annotate at public API surfaces. Return types on every arrow function, variable types for locals, and generic parameters the call site would infer are noise — annotations can drift, inference can't. Do annotate exports, module-level types, and public function signatures where the shape is part of the contract.
