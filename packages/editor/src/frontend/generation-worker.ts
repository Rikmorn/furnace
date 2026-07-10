// The generation worker (Slice 3.2.3): owns the attempt loop off the main thread.
// It imports the SAME same-origin /engine.js the chrome loads — same browser, same
// JS engine, so worker-side placement is identical to main-thread placement (the
// cross-engine determinism rule is JSC-vs-V8, not thread-vs-thread).
//
// SPIKE (Task 6): proves premise #2 — a module worker can dynamic-import the
// engine bundle and read its `extensions` namespace. Task 8 replaces this body
// with the real attempt-loop handler.
//
// Typing note: the frontend tsconfig's `lib` is ["ESNext", "DOM"] — no
// "WebWorker" (the two libs conflict if combined: both declare globals like
// `self`). That types `self` here as `Window & typeof globalThis` rather than
// `WorkerGlobalScope`. Verified this still typechecks clean under that lib set
// for the single-argument onmessage/postMessage usage below — Window's second
// postMessage overload (`postMessage(message, options?)`) and the onmessage
// property both accept this shape. Task 8 can introduce a dedicated
// WebWorker-lib tsconfig for this file if the real handler needs worker-only
// globals (e.g. `importScripts`) that DOM's `self` doesn't expose.
self.onmessage = async (
  e: MessageEvent<{ kind: string; engineUrl?: string }>,
) => {
  const msg = e.data;
  if (msg.kind !== "init" || typeof msg.engineUrl !== "string") return;
  try {
    // Variable indirection: the runtime-built /engine.js must not be resolved at
    // build time (same pattern as lib/engine.ts loadEngine).
    const url: string = msg.engineUrl;
    const mod = (await import(url)) as { extensions: Record<string, unknown> };
    self.postMessage({
      kind: "ready",
      exports: Object.keys(mod.extensions).sort(),
    });
  } catch (err) {
    self.postMessage({
      kind: "init-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
