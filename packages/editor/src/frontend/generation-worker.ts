// The generation worker (Slice 3.2.3): owns the attempt loop off the main thread.
// It imports the SAME same-origin /engine.js the chrome loads — same browser, same
// JS engine, so worker-side placement is identical to main-thread placement (the
// cross-engine determinism rule is JSC-vs-V8, not thread-vs-thread). All logic
// lives in createWorkerHandler (pure, unit-tested); this file only wires the real
// engine import and postMessage.
import {
  createWorkerHandler,
  type WorkerEngine,
  type WorkerRequest,
} from "./lib/generation-protocol.ts";

async function loadEngine(engineUrl: string): Promise<WorkerEngine> {
  // Variable indirection: the runtime-built /engine.js must not be resolved at
  // build time (same pattern as lib/engine.ts loadEngine).
  const url: string = engineUrl;
  const mod = (await import(url)) as { extensions: Record<string, unknown> };
  // Boundary cast: the engine bundle's `extensions` namespace crosses the
  // project-first bundle boundary untyped; the worker narrows it ONCE here (the
  // WorldPanel does the same narrowing on the main thread).
  return mod.extensions as unknown as WorkerEngine;
}

const handle = createWorkerHandler({
  loadEngine,
  // Boundary cast: DedicatedWorkerGlobalScope.postMessage — the frontend tsconfig
  // types `self` as Window; this file only ever runs as a worker.
  post: (msg, transfer) =>
    (self as unknown as Worker).postMessage(msg, transfer ?? []),
});
self.onmessage = (e: MessageEvent<WorkerRequest>) => void handle(e.data);
