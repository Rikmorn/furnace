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
  // build time — a literal specifier is exactly what a bundler resolves eagerly.
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
self.onmessage = (e: MessageEvent<AnalyzerRequest>) => {
  // A rejection here means the failure CHANNEL failed (`post` itself threw), so
  // it cannot be answered over the wire. The protocol marks it handled to keep
  // its queue alive, which also silences the runtime's own unhandled-rejection
  // report — this log is the ONLY remaining signal, not decoration.
  handle(e.data).catch((err: unknown) =>
    console.error("analyzer worker: unreportable failure", err),
  );
};
