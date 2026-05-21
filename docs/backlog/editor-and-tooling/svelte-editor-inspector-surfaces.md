# Svelte editor / inspector surfaces

Svelte 5 is now the committed framework for screen-space DOM UI (see `docs/reference/ui-foundation.md`). The remaining work is editor and inspector surfaces that need to subscribe to engine state — particularly ECS components and entities once those exist.

**Trigger to revisit:** When ECS lands and we need fine-grained state subscription for an entity inspector, OR when the first interactive control panel (shader uniform tweaks, scene parameters) is needed.

**Reference:** `docs/reference/ui-foundation.md` (Svelte 5 with the runes/signals model is the committed framework).
