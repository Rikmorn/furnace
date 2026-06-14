# Scene-format migration chain — deferred until the first breaking change

The scene format is at `version: 1` (`CURRENT_SCENE_VERSION = 1` in `packages/core/src/scene/validate.ts`); `validateDocument` accepts v1 and rejects every other version with `scene: unsupported version N (this build loads version 1)`. v1 is the **first and only** format version that has ever shipped.

Everything the M1-slices batch added — the `textures` + `effects` resource tables, the `light` and `rigidBody` components, and the full settings schema (`ambient` / `post` / `gravity` / `lengthUnit` / `sim` / `msaa` / `hdr`) — is **backward-compatible within v1**: all of it is optional, so a v1 document authored before the batch (no textures table, no light component, `clearColor`-only settings) still loads unchanged. There is **zero version bump and zero migration** to write. Building a migration-chain framework (an ordered old→current transform pipeline in the loader) *now* would be empty scaffold — there is nothing for it to migrate.

The framework is deferred deliberately, not forgotten. When the first migration arrives, the design intent (settled in the M1 scene-format design) is an integer `version` plus an ordered migration chain in the core loader, with **field renames handled explicitly** so a rename **migrates** the old field forward rather than silently dropping it (avoiding the Unity-style silent-rename-data-loss footgun).

**Trigger to revisit:** the first **breaking** format change — a removed/renamed field, a changed value shape, or a resource-kind contract change that an existing v1 document can no longer satisfy. At that point bump `CURRENT_SCENE_VERSION`, build the migration chain (old→current), and write the rename-migrates-not-drops migration for the affected field. Additive-and-optional changes do **not** trigger this (they stay v1).

**Reference:** `packages/core/src/scene/validate.ts` (`CURRENT_SCENE_VERSION`, `validateDocument` version guard), `docs/backlog/engine-architecture/scene-serialization-interchange.md` (§Resolved decisions — the "integer `version` + ordered migration chain, renames handled explicitly" decision this entry defers the implementation of).
