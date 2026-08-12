---
summary: root `scripts/` belongs to no tsconfig, so `bun run typecheck` never sees the docs-system scripts
---

# Root `scripts/` is in no typecheck target

Filed 2026-08-12 during the docs-system slice, which created the root `scripts/` directory
and then found it had nowhere to be typechecked.

## Context

`bun run typecheck` fans out to the five package tsconfigs. Three of those packages include
their own `scripts/**/*` (core and cookbook name it explicitly). The **root** `scripts/`
directory is in none of them, and the root `tsconfig.json` has no `include`, so nothing in
`bun run typecheck` ever sees it.

The docs-system slice put four TypeScript files there (`check-docs.ts`,
`docs-frontmatter.ts`, `docs-index.ts`, `sitrep.ts`) plus their tests. They are typechecked
today only because someone ran `tsc` at them by hand:

```
bunx tsc --noEmit --ignoreConfig --strict --noUncheckedIndexedAccess --noImplicitOverride \
  --noPropertyAccessFromIndexSignature --target esnext --module preserve \
  --moduleResolution bundler --allowImportingTsExtensions --verbatimModuleSyntax \
  --skipLibCheck --types bun --lib esnext,dom scripts/*.ts
```

That is not a gate. `bun test` catches whatever the tests execute; it does not catch a type
error on an unexercised branch.

The obvious fix is a `scripts/tsconfig.json` extending the root options with
`include: ["**/*"]`, plus one more lane on the root `typecheck` script — matching the house
per-directory pattern. It was NOT taken inline because the docs-system plan did not scope it
and the slice's own gate ruling was "root scripts + docs". Adding `include` to the **root**
tsconfig instead would be the wrong shape: it currently globs everything, so naming an
include narrows it repo-wide.

## Trigger to revisit

Next time anything is added to root `scripts/`, or at the docs-system rung-5 slice — whichever
comes first. Cheap enough to take opportunistically in any tranche already touching the root
`package.json`.

## Reference

- Root `package.json` — the `typecheck` script and its five lanes.
- `packages/core/tsconfig.json` — the house pattern (`include` naming `scripts/**/*`).
