# @furnace/hello-world

The reference consumer. Renders the WebGPU triangle with the Svelte 5 FPS overlay — the smallest end-to-end proof that `@furnace/core` works from a plain consumer setup.

## Role

- Owns its own `index.html`, `bunfig.toml`, `serve.ts`, and dev-server choice — consumer packages pick their own toolchain.
- Imports core via `@furnace/core` (workspace symlink).
- Uses `furnace dev --platform=macos` for native dev — dogfooding the consumer experience end to end.

## Commands (from the repo root)

- `bun run hello-world:dev` — browser tab
- `bun run hello-world:dev:native` — native window (macOS Tahoe 26+ / Windows; Linux deferred per `docs/backlog/`)
- `bun run edit` (inside this package) — open the editor on hello-world

Consumer UI patterns (Svelte 5 + screen-space projection): `docs/reference/ui-foundation.md`.
