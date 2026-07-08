// The ephemeral generation session (Slice 3.1 spec §3): plain state + helpers the
// GenerationPanel drives. NO document-session contact — the session lives entirely in
// panel-local React state; the ONLY daemon crossing is freeze (an api call that uploads
// the browser-produced file set). Everything here is pure and unit-tested without a DOM.
import type { PreviewContent } from "../../viewport-host/index.ts"; // type-only: erased

/** The generation session's lifecycle, one variant per user-visible phase. The `done`
 *  variant SNAPSHOTS the config that produced the on-screen preview: freeze bakes from
 *  this snapshot, never from live knobs, so "freeze bakes exactly what you previewed"
 *  holds even if the user edits the config afterwards. */
export type GenerationStatus =
  | { phase: "idle" }
  | { phase: "running"; attempt: number; totalAttempts: number }
  | {
      phase: "done";
      attemptSeed: string;
      attempt: number;
      config: { targetRooms: number; loopChance: number };
    }
  | { phase: "baking" }
  | { phase: "baked"; files: number }
  | { phase: "failed"; error: string }
  | { phase: "cancelled" };

/** The ephemeral session state: the seed + generator knobs, the reroll history (most
 *  recent first), and the current status. Held in panel-local React state. */
export type GenerationSession = {
  baseSeed: string;
  config: { targetRooms: number; loopChance: number };
  history: { attemptSeed: string; baseSeed: string }[];
  status: GenerationStatus;
};

/** A fresh session at the P1-bar defaults (see world.ts COCKPIT_CONFIG). */
export const initialSession = (): GenerationSession => ({
  baseSeed: "wing-1",
  config: { targetRooms: 6, loopChance: 0.35 },
  history: [],
  status: { phase: "idle" },
});

/** The seed for the next reroll. Deterministic-ish naming keeps history legible:
 *  wing-1, wing-1#2, wing-1#3… (the first generate uses the base seed unchanged). */
export function nextRerollSeed(base: string, historyLen: number): string {
  return historyLen === 0 ? base : `${base}#${historyLen + 1}`;
}

/** Drop a `done` preview back to `idle` because an edit (seed or a config knob) made the
 *  on-screen world no longer match the controls — so the Freeze button is only ever enabled
 *  for the world currently previewed. Any non-`done` phase is returned unchanged (same ref). */
export function invalidateDonePreview(
  session: GenerationSession,
): GenerationSession {
  return session.status.phase === "done"
    ? { ...session, status: { phase: "idle" } }
    : session;
}

/** UI-boundary mirror of bake.ts's WING_NAME_RE — refuse before burning a bake. */
export function isValidWingName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(name);
}

/** FALLBACK bake transport: one file for the JSON POST — text verbatim, binary base64'd. */
export type WireFile = {
  path: string;
  encoding: "utf8" | "base64";
  contents: string;
};

/**
 * Marshal the browser-produced bake file set (BakeFile[] — contents string|Uint8Array)
 * into the daemon's `generation.bake` wire shape: text files pass through as `utf8`;
 * binary sidecars (`.fmesh`) are base64-encoded for the JSON POST (the daemon decodes).
 */
export function toWireFiles(
  files: { path: string; contents: string | Uint8Array }[],
): WireFile[] {
  return files.map((f) =>
    typeof f.contents === "string"
      ? { path: f.path, encoding: "utf8", contents: f.contents }
      : {
          path: f.path,
          encoding: "base64",
          contents: bytesToBase64(f.contents),
        },
  );
}

// Chunked so a large sidecar can't blow the argument stack on String.fromCharCode(...).
const BASE64_CHUNK = 0x8000;
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * One realize result the panel folds into the preview: the engine handles a single
 * `realizeRegion` produced. Kept structural (not the concrete engine types) so this
 * pure module never touches engine code — the panel casts at its bundle-boundary seam.
 */
export type RealizeResult = {
  meshes: unknown[];
  instanced: unknown[];
  update?: () => void;
  destroy: () => void;
};

/**
 * Fold a set of realize results + the shared MaterialCache into ONE `PreviewContent`
 * for the preview host: flattened mesh/instanced handles, an `update` that ticks every
 * result, and a `destroy` that frees every result AND the shared cache (the cache
 * outlives the regions, so the merged content owns tearing it down).
 */
export function mergeContents(
  results: RealizeResult[],
  cache: { destroy: () => void },
): PreviewContent {
  return {
    meshes: results.flatMap((r) => r.meshes),
    instanced: results.flatMap((r) => r.instanced),
    update: () => {
      for (const r of results) r.update?.();
    },
    destroy: () => {
      for (const r of results) r.destroy();
      cache.destroy();
    },
  };
}

type Vec3 = [number, number, number];
type Bounded = { bounds: { min: Vec3; max: Vec3 } };

// A sane unit box when there is nothing to frame (an all-connectors-only edge case).
const EMPTY_BOUNDS: [Vec3, Vec3] = [
  [-1, -1, -1],
  [1, 1, 1],
];

/** Union the AABB `bounds` of a set of placed pieces into one `[min, max]` the preview
 *  host frames the orbit camera on. Returns a unit box for an empty input. */
export function layoutBounds(regions: Bounded[]): [Vec3, Vec3] {
  const first = regions[0];
  if (!first) return EMPTY_BOUNDS;
  let [minX, minY, minZ] = first.bounds.min;
  let [maxX, maxY, maxZ] = first.bounds.max;
  for (const r of regions) {
    minX = Math.min(minX, r.bounds.min[0]);
    minY = Math.min(minY, r.bounds.min[1]);
    minZ = Math.min(minZ, r.bounds.min[2]);
    maxX = Math.max(maxX, r.bounds.max[0]);
    maxY = Math.max(maxY, r.bounds.max[1]);
    maxZ = Math.max(maxZ, r.bounds.max[2]);
  }
  return [
    [minX, minY, minZ],
    [maxX, maxY, maxZ],
  ];
}
