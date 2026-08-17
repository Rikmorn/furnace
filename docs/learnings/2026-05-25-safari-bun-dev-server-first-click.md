# Safari first-click navigation race on Bun's dev server (May 2026)

*The fix lives in `packages/cookbook/serve.ts` as a four-line prewarm. This note exists so the next person doesn't delete it thinking it's unneeded.*

## The bug

Bun 1.3.14. Open the cookbook menu in a fresh Safari window (`bun run cookbook:dev` → http://localhost:8766/), click any demo card the first time → network activity but the page sticks on the menu. Click the same card again → navigates fine. One wasted click per cold demo. Chrome doesn't reproduce. Safari is the project's primary browser, so this matters.

## Root cause (with what evidence we have)

Two facts established by tracing:

1. Bun's dev server **lazy-compiles each `HTMLBundle` import on first request and caches in memory.** The "Bundled page in Xms: src/demos/<slug>/index.html" log line appears exactly once per demo, on whichever request lands first. Compile latency is 20–200ms.
2. Bun injects an HMR client (`/_bun/client/index-<hash>.js`) into every dev-served HTML response. On initial module sync the client decodes the modules into a Blob and appends a `<script class="bun-hmr-script">` with `src = URL.createObjectURL(blob)`. In Safari that blob-URL `<script>` fires `onerror` ("Failed to load HMR script") during the navigation transition.

What we *don't* fully understand: why a failed dynamic script load blocks visible navigation commit. The error handler still calls the page-init continuation, so on paper the navigation should commit. The plausible mechanism is Safari speculation racing with slow first-byte (compile latency) and blob-URL `<script>` injection during transition — but we didn't isolate the exact step. Pre-warming the bundle cache eliminates the latency window and that's sufficient to suppress the bug.

## The fix

In `packages/cookbook/serve.ts`, immediately after `Bun.serve(...)`:

```ts
await Promise.all(
  Object.keys(routes).map((path) => fetch(new URL(path, server.url))),
);
```

Cost: ~200ms one-time at server startup. Benefit: bug eliminated.

## Reproducing it (if it ever comes back)

1. Revert the prewarm block in `packages/cookbook/serve.ts`.
2. `bun run cookbook:dev` — log shows "Serving 9 demo(s)" with no "Bundled page" lines yet.
3. Fresh Safari Private window → http://localhost:8766/ → click any card.
4. First click: page stays on menu, Safari Web Inspector → Console shows "Failed to load HMR script". Simultaneously the dev-server log emits "Bundled page in Xms: ..." for that demo.
5. Click the same card again → navigates fine.

## When to remove the workaround

On any Bun version bump past 1.3.14. Revert the prewarm, walk through the reproduction recipe; if Safari navigates cleanly without it, drop the workaround. If it still reproduces, put the prewarm back.
