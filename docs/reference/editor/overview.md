---
summary: Orientation — the three pieces, the project-first invariant that keeps the engine out of the editor, and the run command.
verified: 2026-08-18
---

# What the editor is

`@furnace/editor` is a **field authoring tool**: one full-window canvas with an overlay
cockpit floating over it, a Node-portable daemon behind it, and no engine of its own. It is
a **devDependency** of the consumer plus a long-running local daemon and a browser-served
chrome. It is not a binary and it is not vendored into anything — the consumer adds it to
`devDependencies` and runs it with a command, the Storybook/Vite model.

The decision history that produced it lives in
`docs/backlog/editor-and-tooling/editor-backend-architecture.md`; these files describe the
running system.

## The zero-engine invariant

**The editor contains no engine.** This is the load-bearing invariant, called *project-first
resolution*: every engine import — `@furnace/core`, the consumer's extensions, the
field-host — is resolved and bundled *from the consumer's own `node_modules`*, never from
the editor package's. The editor ships UI chrome and a daemon; the engine code is always the
consumer's.

`packages/editor/package.json` declares `@furnace/core` only as a `devDependency`, used for
types and the workspace symlink; the runtime engine bundle is built from the project root
([bundling](bundling.md)).

## There is no scene document

The field artifact **is** the content model. Nothing in furnace holds a scene document — not
the daemon, not the chrome, not core. A world is a directory of chunks, `.mat` siblings and
an `oplog.json`, and every schema decision happens in the browser inside the field host and
the generator registry it drives. The transactional `apply` design that the deleted document
session used outlived its code as a donor pattern:
`docs/learnings/2026-08-05-session-apply-transactional-pattern.md`.

## Running it

In `packages/hello-world`, `bun run edit` runs the `"edit"` script:

```
bun run --cwd ../editor build:frontend && bun ../editor/src/daemon/main.ts
```

It prebuilds the chrome ([bundling](bundling.md)), then starts the daemon with the
consumer's directory as the project root — `packages/editor/src/daemon/main.ts` takes
`process.cwd()`. The banner prints two addresses: the chrome's, and the agent door's, whose
path comes from `mcp.ts` rather than a literal so it cannot outlive a move.

## The halves

| Half | Owns | File |
|---|---|---|
| The daemon | bytes and the filesystem — binding, routing, the trust boundary, project config | [daemon](daemon.md) |
| The command layer | one validating choke point for every client | [commands](commands.md) |
| The error contract | the closed code union and its per-transport mappings | [error-contract](error-contract.md) |
| The change feed | SSE notification, the session claim, directory watching | [change-feed](change-feed.md) |
| Bundling | the project-resolved engine bundle, the chrome build, the layer arrow | [bundling](bundling.md) |
| The inspector | the schema-driven form the chrome renders generator params into | [inspector](inspector.md) |

**The daemon owns bytes and the filesystem; the browser owns the world.**
