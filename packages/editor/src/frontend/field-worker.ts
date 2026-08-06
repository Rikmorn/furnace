// Field remesh worker entry — ships as its own bundle (see build-frontend.ts).
// Mirrors analyzer-worker.ts's self/postMessage idiom; all logic lives in the
// pure createFieldWorkerHandler so this file only wires the real self.postMessage.

import type { FieldWorkerRequest } from "../viewport-host/field-protocol.ts";
import { createFieldWorkerHandler } from "../viewport-host/field-protocol.ts";

const handler = createFieldWorkerHandler((msg, transfer) =>
  // Boundary cast: DedicatedWorkerGlobalScope.postMessage — the frontend
  // tsconfig types `self` as Window; this file only ever runs as a worker.
  (self as unknown as Worker).postMessage(msg, transfer),
);
self.onmessage = (e: MessageEvent<FieldWorkerRequest>) => handler(e.data);
