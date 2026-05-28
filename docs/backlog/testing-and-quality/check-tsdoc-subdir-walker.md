# `check-tsdoc.ts` walker requires `index.ts` per src subdirectory

`packages/core/scripts/check-tsdoc.ts` collects modules by iterating every directory under `packages/core/src/` and looking up `index.ts` in each:

```ts
function collectModuleIndices(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(SRC_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = resolve(SRC_ROOT, entry.name, "index.ts");
    out.push(indexPath);
  }
  return out;
}
```

If a subdirectory exists without an `index.ts`, the walker errors with `ENOENT`. The check has no allow-list, no skip-empty path, and no way to mark a subdir as "internal — no module index expected".

Surfaced during Resource Manager Session 1 (Tranche RM-1, Task 1.1): `packages/core/src/resources/` is engine-internal until Session 4 introduces the public `resources.*` module. Task 1.1 created a stub `packages/core/src/resources/index.ts` purely to satisfy the walker, with a header comment explaining the workaround:

```ts
// Engine-internal module — not part of `@furnace/core`'s public exports
// (see `packages/core/package.json`). This file exists so the structural
// `check-tsdoc.ts` walker (which expects one `index.ts` per src subdir)
// has something to read. Public resource-manager surface is introduced
// in Session [4]; until then everything below is engine-internal.
```

The stub now re-exports pool / handle / manager / internal symbols and adds noise every time we add a new file to `resources/` (touch one extra file per change).

## Fix shape

Two viable approaches; pick during the cleanup tranche:

1. **Walker tolerates missing `index.ts`.** Change `collectModuleIndices` to skip directories whose `index.ts` doesn't exist (e.g. `fs.existsSync(indexPath)` filter). Pro: zero code change required in the resources/ stub once Session 4's public index lands. Con: silently skipping subdirs hides the case where a public module forgot its index.

2. **Walker reads a manifest.** Each src subdir declares its status in a small `module.json` (or via `package.json`'s `exports` map): `{"public": true}` (walker enforces index + TSDoc), `{"public": false}` (walker ignores). Pro: explicit intent. Con: another tiny config file format.

Strong preference for option 1 — the walker's job is "enforce TSDoc on public exports"; nothing to enforce means nothing to walk.

## What to verify when fixing

- `bun run check:tsdoc` still passes for every current public module (`stats/`, `gpu/`, `mesh/`, `material/`, `post/`, `frame/`, `transform/`, `events/`, `log/`, `camera/`, `errors.ts` if applicable).
- A new subdir without `index.ts` no longer breaks the check.
- The engine-internal `resources/index.ts` stub can be deleted once Session 4 introduces the public `resources.*` module index — verify this transition works.

**Trigger to revisit:** When `resources/index.ts` is materialised as a real public module (Session 4 of the resource-manager rollout), OR when a second engine-internal subdir gets created and faces the same workaround.

**Reference:** Surfaced during Tranche RM-1 Task 1.1 (pool primitive), 2026-05-28. The workaround stub lives at `packages/core/src/resources/index.ts` with a header comment.
