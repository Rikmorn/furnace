# Bun dev-server prewarm workaround — remove on Bun upgrade

`packages/cookbook/serve.ts` includes a `Promise.all(...)` prewarm that fetches every route at server startup. It works around a Safari-only first-click navigation failure caused by Bun 1.3.14's lazy `HTMLBundle` compile racing with the HMR client's blob-URL `<script>` injection. See [`docs/learnings/safari-bun-dev-server-first-click.md`](../../learnings/safari-bun-dev-server-first-click.md).

The workaround adds ~200ms to `bun run dev:cookbook` startup. Acceptable today, but worth removing when Bun fixes the upstream behavior.

**Trigger to revisit:** Any Bun version bump past 1.3.14. Revert the prewarm, run the reproduction recipe in the learnings doc, and put it back only if Safari still fails.

**Reference:** [`docs/learnings/safari-bun-dev-server-first-click.md`](../../learnings/safari-bun-dev-server-first-click.md); workaround in [`packages/cookbook/serve.ts`](../../../packages/cookbook/serve.ts).
