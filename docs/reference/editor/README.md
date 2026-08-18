# The editor, as built

`@furnace/editor` per subsystem — present tense, one subsystem per file. Start at
[overview](overview.md) if you have not read any of these before.

**This index is generated** from every member's H1 and `summary:` frontmatter by
`bun run docs:index`, into the region between the `reference-index` markers below;
`bun run check` fails on drift. Everything outside the markers is hand-written. Adding a
subsystem file means adding its `summary:` and regenerating — a member with no `summary:` or
no H1 fails the generator rather than being listed blank.

## The files

<!-- reference-index -->

- [The action registry](action-registry.md) — The editor's verbs as Node-importable rows — the descriptor table, the gate's caller split, and `ActionResult`, the one refusal vocabulary every surface and the agent door share.
- [The walkability advisor](advisor.md) — A dedicated worker that mirrors the field, flags where the project's own agent cannot walk, and on demand drives the real mover at one finding to prove it.
- [The agent door](agent-door.md) — How an agent reads and drives a live editor — the MCP tool set, the browser backchannel it relays through, the guest clause, and the per-turn byte budgets that bind it.
- [Bundling](bundling.md) — Two builds — the project-resolved engine bundle the daemon serves, and the prebuilt React chrome — plus the layer arrow both obey.
- [The change feed and the session claim](change-feed.md) — The SSE broadcaster and its event table, the session claim and connection token, and the one directory the daemon watches.
- [Commands](commands.md) — The one dispatch choke point every client funnels through, and the command table with each verb's input schema and return.
- [The daemon](daemon.md) — The Node-portable HTTP server — loopback bind, the Origin refusal, the route ladder, the trust boundary, and project config.
- [The error contract](error-contract.md) — The closed `EditorErrorCode` union, its HTTP status table, and the agent-door edge that maps every code to a remedy.
- [The field host](field-host.md) — The browser-side engine facade — the multicast view channel, the substrate record every extracted cluster is handed, and the deps-record law that keeps the seam modules assemblable.
- [The inspector module](inspector.md) — The swappable schema-driven form — kind resolution, the kind→renderer registry, `<SchemaForm>`'s draft/validation/echo-guard contract.
- [Interaction](interaction.md) — What LMB and Esc do — the gesture machine, the CPU pick arbitration, the recency-ordered Esc capture stack, and the canonical-setter law that keeps the two honest.
- [What the editor is](overview.md) — Orientation — the three pieces, the project-first invariant that keeps the engine out of the editor, and the run command.

<!-- /reference-index -->

## Where the history went

These files say how the editor IS. The narration — which slice built what, which approach was
tried and dropped, which count was wrong before it was re-derived — lives in
`docs/learnings/seals/`, one file per sealed slice, indexed there. Deferred work lives in
`docs/backlog/editor-and-tooling/`.
