// packages/dungeon/src/editor-extensions.ts
// The editor's project-first bundle entry for the dungeon (furnace.config.json →
// editor.extensions). No registry extensions today — the dungeon uses only core
// built-ins. The re-exports prove (and keep proving, via the editor-side bundling smoke
// test) that the dungeon's agent/analyzer import graph is browser-bundlable from the dungeon
// root. The engine bundle may tree-shake unused exports.
//
// WHAT THE EDITOR ACTUALLY CALLS OFF THIS MODULE: exactly ONE function, `analyzerVerify`,
// resolved by `frontend/analyzer-worker.ts` through the registry service seam (`defineService`
// below / `getService` off the bundle) and narrowed once at the worker's boundary cast
// (`AnalyzerEngine`). `AGENT` and `MaterialCache` ride along as the analyzer's agent profile and
// the dungeon's one GPU-material seam; they are not a live editor contract, so do not treat a
// change to their shape as an editor-facing break.
// `docs/reference/editor-architecture.md` §3a records the same fact from the editor's side.
import { defineService } from "@furnace/core/registry";
import { analyzerVerify } from "./agent/walk-probe.ts";

// Branch A: importing this module is what makes the service reachable.
// Boundary note: analyzerVerify's opts carry runtime objects (FieldStore),
// so the service registers UNVALIDATED input — existence is what the
// registry guarantees; the shape contract stays the editor-side wire twin.
defineService("analyzerVerify", { fn: analyzerVerify });

// Stage 2 of the walkability advisor. The analyzer worker calls `analyzerVerify` off this same
// untyped view of the module; it needs no GPU context and mutates nothing.
export {
  type AnalyzerVerifyOptions,
  analyzerVerify,
  type VerifyLane,
  type VerifyLaneOutcome,
  type VerifyOutcome,
  type VerifyReason,
  type VerifyVerdict,
} from "./agent/walk-probe.ts";
/** The dungeon's agent profile (`catalog/agent.json`) — the argument core's `analyzeChunk` /
 *  `analyzeWorld` / `markUnreachable` are parameterized on, and the one `analyzerVerify` accepts. */
export { AGENT } from "./agent/walkability.ts";
export { MaterialCache } from "./world/realize.ts";
