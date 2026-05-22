# Engine cascade teardown / unified shutdown

Today the engine has explicit per-module disposal (`gpu.dispose(ctx)`, `frameLoopHandle.stop()`, `input.detach()`, future `mesh.destroy(handle)` / `material.destroy(handle)` / etc.) but no single "destroy the engine" function. The consumer is expected to remember each tear-down and call them in the right order. For hello-world this is fine — the demo never tears down, page reload reclaims everything — but for any long-running consumer (an SPA mounting/unmounting the engine, a route change, a hot-module reload that needs clean teardown) the per-module list becomes a footgun: forget one and you leak resources or get "callback fired after dispose" bugs.

Implementation sketch — most likely shape: extend `gpu.dispose(ctx)` with a registration hook, then have each module register itself when it acquires ctx-bound resources.

```ts
// gpu module — new public API
export function onDispose(ctx: Context, cb: () => void): () => void;  // returns unsub

// every other module — internal pattern
input.attach(canvas /*, optional ctx? */) {
  // ... install DOM listeners ...
  gpu.onDispose(ctx, () => input.detach());  // self-register
}
```

The consumer keeps calling `gpu.dispose(ctx)` as today; the cascade fans out automatically. Modules that aren't ctx-bound (pure `camera` math) need no registration. Modules with their own optional disposal (consumer wants to detach input *without* tearing down the device) keep their explicit `.detach()` — `onDispose` is additive.

Open design questions:
- Does `input.attach(canvas)` need to also take `ctx`, or can it find the active ctx some other way? Adding `ctx` to attach is a real ergonomic cost on the demo; an "active ctx singleton" registry inside `gpu` is one of the things this engine is trying *not* to be.
- Ordering: if input has registered an `onDispose` and `frame.loop` has too, does the loop stop *before* the input detaches, or vice versa? Probably stop loops first (no more frame callbacks), then detach input (no more event firing), then destroy device. The dispose function needs a documented ordering, or the modules need to know their own dependencies.
- Should `onDispose` callbacks be allowed to throw, and what does dispose do if one does? Probably swallow + console.error so a misbehaving module doesn't block the rest of the cascade. Mirrors the `device.destroy()` swallow already in `gpu.dispose`.
- Does `frame.loop` need to expose its handle for engine-managed disposal, or self-register too? Self-register is consistent but adds coupling — `frame` would need to import `gpu` for `onDispose`, breaking the current tidy one-direction dependency graph (`frame` depends on `gpu` types only).
- Is this the right place for a "tear down everything including subscribers" semantic, or do we keep `gpu.dispose` narrow and introduce `engine.shutdown(ctx)` as a higher-level umbrella that calls `gpu.dispose` + everything else? The umbrella version is honest about what it does; the cascade-from-dispose version is fewer concepts. Lean umbrella.

Adjacent concerns that probably want to be solved together:
- `device.lost` handling — different trigger, same fanout shape. The browser kills the GPU device (driver crash, tab backgrounded too long); modules need to be told. Right now nobody listens.
- Page-visibility-driven pause/resume (`frame.loop`'s `pauseOnHidden` already handles its piece; if `input` ever grows a "release-all-keys on hidden" behavior it'd want a coordinated path).
- Hot-module-reload (Bun's `--hot`) — between sessions today the engine just gets re-created; an engine that knew how to tear itself down cleanly would survive HMR more gracefully.

**Trigger to revisit:** First real consumer (not hello-world) that mounts/unmounts the engine — likely an SPA route or a component-framework integration. Also worth revisiting if `device.lost` recovery becomes a real requirement (more than "show an error message"), since the cascade machinery is the same.

**Reference:** Tranche 3 design discussion — surfaced as a question during the hello-world integration section. Master arch spec § Section 5 ("Resource lifetimes") and `docs/reference/engine-conventions.md` § Disposal already document the explicit-per-module contract; this entry tracks the unified-teardown evolution of it.
