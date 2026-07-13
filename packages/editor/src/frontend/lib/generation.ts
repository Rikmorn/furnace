// The ephemeral world-generation session (Epic 3; lifted to App level in 3.2.2): plain
// state + helpers. NO document-session contact — App owns the session + worker client (so
// it survives the panel closing) and the WorldPanel drives them as a context consumer; the
// ONLY daemon crossing is freeze (api calls that upload the worker-produced file set).
// Everything here is pure and unit-tested without a DOM.
import type { PreviewContent } from "../../viewport-host/index.ts"; // type-only: erased
import type { WorldDraft, WorldSpecLike } from "./world-draft.ts"; // type-only: erased

// ── The world flow ─────────────────────────────────────────────────────────────
// The panel assembles a WorldDraft (world-draft.ts); realize stays DETERMINISTIC
// (realizeWorldSpec — no search), so it carries no attempt/envelope semantics: one
// Generate → one payload → preview. `previewing` snapshots the FULL SPEC that produced
// the on-screen world (D-W3-11): freeze bakes exactly that snapshot, so a draft edit
// after generating can never change what freeze produces.

export type WorldGenStatus =
  | { phase: "idle" }
  | { phase: "generating" }
  | { phase: "previewing"; spec: WorldSpecLike }
  | { phase: "baking" }
  | { phase: "baked"; files: number; madeDefault: boolean }
  | { phase: "failed"; error: string };

/** The world cockpit's ephemeral state: the draft under assembly, the make-this-the-
 *  game's-world toggle (D-W3-9, default ON), and the current status. App-lifted so it
 *  survives the panel being closed (an in-flight run keeps updating it). */
export type WorldGenSession = {
  draft: WorldDraft;
  makeDefault: boolean;
  status: WorldGenStatus;
};

/** A fresh idle world session: an EMPTY draft (D-W3-12 — assembly starts from scratch;
 *  no spec→draft import until 3.5 needs one). The name defaults to "default" so a
 *  Freeze&bake overwrites worlds/default — the world the committed worlds/index.json
 *  already points at. */
export const initialWorldSession = (): WorldGenSession => ({
  draft: { name: "default", regions: [], startRegionId: "" },
  makeDefault: true,
  status: { phase: "idle" },
});

/** Drop a `previewing` world back to `idle` because a draft edit made the on-screen world
 *  no longer match the controls — Freeze only ever bakes what is previewed. Any
 *  non-`previewing` phase is returned unchanged (same reference). */
export function invalidateWorldPreview(s: WorldGenSession): WorldGenSession {
  return s.status.phase === "previewing"
    ? { ...s, status: { phase: "idle" } }
    : s;
}

/** UI-boundary mirror of bake.ts's WORLD_NAME_RE — refuse before burning a bake. */
export function isValidWorldName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(name);
}

/** The daemon upload sequence for a world bake (D-W3-9): the world's own file set,
 *  cleanDir'd to its directory (a re-bake never leaves orphans) — then, when the user
 *  asked to make it the game's world, ONE more root-contained write of
 *  worlds/index.json with NO cleanDir (it lives outside the world dir, and the daemon
 *  validates every file against cleanDir when one is set). Pure — the panel executes the
 *  calls in order. */
export function bakeUploadCalls(
  files: WireFile[],
  worldDirPath: string,
  worldName: string,
  makeDefault: boolean,
): { files: WireFile[]; cleanDir?: string }[] {
  const calls: { files: WireFile[]; cleanDir?: string }[] = [
    { files, cleanDir: worldDirPath },
  ];
  if (makeDefault) {
    calls.push({
      files: [
        {
          path: "worlds/index.json",
          encoding: "utf8",
          // Byte-identical to the committed packages/dungeon/worlds/index.json (2-space
          // JSON + trailing newline), so re-defaulting "default" is a no-op diff.
          contents: `${JSON.stringify({ version: 1, default: worldName }, null, 2)}\n`,
        },
      ],
    });
  }
  return calls;
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

/** A world-frame point. The ONE spelling the cockpit uses — the panel's preview pieces
 *  and layoutBounds' AABBs are the same triple. */
export type Vec3 = [number, number, number];
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
