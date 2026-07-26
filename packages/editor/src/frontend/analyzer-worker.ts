// Walkability analyzer worker entry — ships as its own bundle (see
// build-frontend.ts). Mirrors field-worker.ts; all logic lives in the pure
// createAnalyzerWorkerHandler, so this file only wires the real self.postMessage
// and the real /engine.js import.

import type {
  AnalyzerEngine,
  AnalyzerRequest,
} from "./lib/analyzer-protocol.ts";
import { createAnalyzerWorkerHandler } from "./lib/analyzer-protocol.ts";

async function loadEngine(engineUrl: string): Promise<AnalyzerEngine> {
  // Variable indirection: the runtime-built /engine.js must not be resolved at
  // build time (the generation worker's loadEngine, same reason).
  const url: string = engineUrl;
  const mod = (await import(url)) as { extensions: Record<string, unknown> };
  // Boundary cast: the engine bundle's `extensions` namespace crosses the
  // project-first bundle boundary untyped; the worker narrows it ONCE here.
  return mod.extensions as unknown as AnalyzerEngine;
}

const handle = createAnalyzerWorkerHandler({
  loadEngine,
  // Boundary cast: DedicatedWorkerGlobalScope.postMessage — the frontend
  // tsconfig types `self` as Window; this file only ever runs as a worker.
  post: (msg) => (self as unknown as Worker).postMessage(msg),
});
self.onmessage = (e: MessageEvent<AnalyzerRequest>) => void handle(e.data);
