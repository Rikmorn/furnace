# Svelte editor / inspector surfaces

Svelte 5 is now the committed framework for screen-space DOM UI (see `docs/reference/ui-foundation.md`). The remaining work is editor and inspector surfaces that need to subscribe to engine state — particularly ECS components and entities once those exist.

**Trigger to revisit:** When ECS lands and we need fine-grained state subscription for an entity inspector, OR when the first interactive control panel (shader uniform tweaks, scene parameters) is needed.

**Reference:** `docs/reference/ui-foundation.md` (Svelte 5 with the runes/signals model is the committed framework). The **editor epic** (`docs/superpowers/specs/2026-06-09-editor-epic-design.md`, DRAFT) proposes the *editor frontend* may use React/shadcn rather than in-page Svelte 5 (backend-arch decision 6) — Svelte stays for in-page/game UI; the reflection-driven inspector this item anticipates is epic milestone 5.
