// The World panel's draft model (W3, D-W3-7): attach-on-add. Every region after the
// first enters WITH the connector that ties it to an EARLIER region, so the world is a
// TREE by construction (each add = one node + one edge incident to it → always
// derivable, never isolated, no cycles) and grid regions' doors are ASSEMBLED from
// attachments — portal indices cannot drift. Pure data + functions: no DOM, no engine
// imports (structural mirrors only — the project-first boundary; the dungeon's
// realizeWorldSpec is the one consumer of the produced spec, across the worker seam).

export type WallName = "north" | "south" | "east" | "west";

/** One end of an attachment: a wall door (grid regions — offset in the stamper's own
 *  unit: coarse cells for halls, maze cells for mazes) or a mouth index (caves). */
export type PortalSpot = { wall: WallName; offset: number } | { mouth: number };

export type DraftAlgorithm = "hall" | "maze" | "cave";

export type ConnectorKindDraft =
  | "corridor"
  | "aperture"
  | "collar-bore"
  | "organic-tunnel";

export type DraftAttachment = {
  kind: ConnectorKindDraft;
  parentId: string;
  parentPortal: PortalSpot;
  childPortal: PortalSpot;
  /** Corridor knobs (length / vertical rise); other kinds carry none. */
  params?: { length?: number; deltaY?: number };
};

// Structural knob mirrors (doors are NOT knobs — attachments own them, D-W3-7).
export type HallKnobs = {
  size: [number, number, number];
  pillars: { kind: "none" } | { kind: "grid" | "colonnade"; spacing: number };
};
export type MazeKnobs = { cells: [number, number]; braid: number };
export type CaveKnobs = { mouths: number };

export type DraftRegion =
  | {
      id: string;
      algorithm: "hall";
      knobs: HallKnobs;
      seed: string;
      attachment?: DraftAttachment;
    }
  | {
      id: string;
      algorithm: "maze";
      knobs: MazeKnobs;
      seed: string;
      attachment?: DraftAttachment;
    }
  | {
      id: string;
      algorithm: "cave";
      knobs: CaveKnobs;
      seed: string;
      attachment?: DraftAttachment;
    };

export type WorldDraft = {
  name: string;
  regions: DraftRegion[];
  startRegionId: string;
};

/** Structural mirror of the dungeon's WorldSpec (draftToSpec's output; the worker
 *  consumes it opaquely). */
export type WorldSpecLike = {
  name: string;
  regions: Record<string, unknown>[];
  connectors: Record<string, unknown>[];
  startRegion: string;
};

/** Cosmetic mirrors of the dungeon's HALL_PRESETS (defaults only — the engine
 *  re-validates all knobs at stamp time, so drift here cannot corrupt a bake). */
export const HALL_PRESET_KNOBS: Record<
  "boxRoom" | "pillarHall" | "greatHall",
  HallKnobs
> = {
  boxRoom: { size: [8, 6, 8], pillars: { kind: "none" } },
  pillarHall: { size: [10, 7, 16], pillars: { kind: "colonnade", spacing: 3 } },
  greatHall: { size: [16, 9, 24], pillars: { kind: "grid", spacing: 4 } },
};

/** Fresh-region knob defaults per algorithm. */
export const DEFAULT_KNOBS: {
  hall: HallKnobs;
  maze: MazeKnobs;
  cave: CaveKnobs;
} = {
  hall: HALL_PRESET_KNOBS.pillarHall,
  maze: { cells: [4, 4], braid: 0.15 },
  cave: { mouths: 1 },
};

/** The connector kinds that can join parent → child, by algorithm pair. The empty
 *  cave→grid cell is deliberate (W3 plan refinement 2): the collar must ride the
 *  connector's a-end (the grid side) but derivation only places b-ends, so a grid
 *  child can never hang off a cave parent — attach grids to grids; hang caves off
 *  either. A reverse/loop verb is 3.5 depth. */
export function legalKinds(
  parent: DraftAlgorithm,
  child: DraftAlgorithm,
): ConnectorKindDraft[] {
  const parentGrid = parent !== "cave";
  const childGrid = child !== "cave";
  if (parentGrid && childGrid) return ["corridor", "aperture"];
  if (parentGrid && !childGrid) return ["collar-bore"];
  if (!parentGrid && !childGrid) return ["organic-tunnel"];
  return [];
}

/** The next free `${algorithm}-N` id — max existing suffix + 1, so removals never
 *  resurrect an id. */
export function nextRegionId(
  draft: WorldDraft,
  algorithm: DraftAlgorithm,
): string {
  const re = new RegExp(`^${algorithm}-(\\d+)$`);
  let max = 0;
  for (const r of draft.regions) {
    const m = re.exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${algorithm}-${max + 1}`;
}

/** Append a region. The FIRST region is the origin anchor (no attachment); every
 *  later region must attach to an EXISTING region with a kind the pair allows.
 *  The first region also becomes the default start. Throws setup-loud. */
export function addRegion(draft: WorldDraft, region: DraftRegion): WorldDraft {
  if (draft.regions.some((r) => r.id === region.id)) {
    throw new Error(`world draft: duplicate region id ${region.id}`);
  }
  if (draft.regions.length === 0) {
    if (region.attachment) {
      throw new Error(
        "world draft: the first region is the anchor — it takes no attachment",
      );
    }
  } else {
    const att = region.attachment;
    if (!att) {
      throw new Error(
        `world draft: ${region.id} needs an attachment (only the first region is free-standing)`,
      );
    }
    const parent = draft.regions.find((r) => r.id === att.parentId);
    if (!parent) {
      throw new Error(`world draft: unknown parent ${att.parentId}`);
    }
    if (!legalKinds(parent.algorithm, region.algorithm).includes(att.kind)) {
      throw new Error(
        `world draft: ${att.kind} cannot join ${parent.algorithm} -> ${region.algorithm}`,
      );
    }
  }
  return {
    ...draft,
    regions: [...draft.regions, region],
    startRegionId: draft.startRegionId || region.id,
  };
}

/** A region is removable iff nothing attaches to it (a LEAF of the tree). */
export function canRemove(draft: WorldDraft, id: string): boolean {
  return !draft.regions.some((r) => r.attachment?.parentId === id);
}

/** Remove a leaf region; the start falls back to the first region if it pointed at
 *  the removed one. Throws on non-leaves (setup-loud; the panel disables the button). */
export function removeRegion(draft: WorldDraft, id: string): WorldDraft {
  if (!canRemove(draft, id)) {
    throw new Error(
      `world draft: ${id} has attached regions — remove its leaves first`,
    );
  }
  const regions = draft.regions.filter((r) => r.id !== id);
  const startRegionId =
    draft.startRegionId === id ? (regions[0]?.id ?? "") : draft.startRegionId;
  return { ...draft, regions, startRegionId };
}

const SEED_COUNTER_RE = /^(.*)-(\d+)$/;

/** Bump (or add) a trailing `-N` counter — the legible, reproducible reroll step. */
export function bumpSeed(seed: string): string {
  const m = SEED_COUNTER_RE.exec(seed);
  return m ? `${m[1]}-${Number(m[2]) + 1}` : `${seed}-2`;
}

/** Per-region reroll (D-W3-8): bump ONE region's seed; the caller re-realizes the
 *  whole world (deterministic + cheap at gate scale). */
export function bumpRegionSeed(draft: WorldDraft, id: string): WorldDraft {
  return {
    ...draft,
    regions: draft.regions.map((r) =>
      r.id === id ? { ...r, seed: bumpSeed(r.seed) } : r,
    ),
  };
}

/** The derived-placement placeholder every region carries out of the draft: the anchor
 *  reads as explicit-at-origin, the rest derive from their connectors at realize time
 *  (world-build.ts identifyDerivedRegions). */
const zeroPlacement = () => ({ translation: [0, 0, 0], yaw: 0 });

/** The per-region door lists + the claimed-portal set, assembled as `draftToSpec`
 *  walks the attachments. */
type DoorAssembly = {
  doors: Map<string, { wall: WallName; offset: number }[]>;
  claimed: Set<string>;
};

/** Resolve one attachment end to the portal INDEX the connector will reference,
 *  appending to the owning grid region's door list on the way (append order IS portal
 *  indexing); cave mouths are already indices and pass straight through. Throws
 *  setup-loud on a spot the wrong class can't hold, an out-of-range mouth, or a spot
 *  already claimed by another connector. */
function portalIndexOf(
  asm: DoorAssembly,
  region: DraftRegion,
  spot: PortalSpot,
): number {
  const key =
    "mouth" in spot
      ? `${region.id}:m${spot.mouth}`
      : `${region.id}:${spot.wall}:${spot.offset}`;
  if (asm.claimed.has(key)) {
    throw new Error(`world draft: portal ${key} used twice`);
  }
  asm.claimed.add(key);

  if (region.algorithm === "cave") {
    if (!("mouth" in spot)) {
      throw new Error(`world draft: ${region.id} is a cave — pick a mouth`);
    }
    const { mouths } = region.knobs;
    if (
      !Number.isInteger(spot.mouth) ||
      spot.mouth < 0 ||
      spot.mouth >= mouths
    ) {
      throw new Error(
        `world draft: ${region.id} mouth ${spot.mouth} outside [0, ${mouths})`,
      );
    }
    return spot.mouth;
  }

  if ("mouth" in spot) {
    throw new Error(
      `world draft: ${region.id} is grid-built — pick a wall door`,
    );
  }
  const list = asm.doors.get(region.id) ?? [];
  list.push({ wall: spot.wall, offset: spot.offset });
  asm.doors.set(region.id, list);
  return list.length - 1;
}

/** Emit the region row for the spec, reading its assembled doors (grid classes only). */
function regionSpec(
  region: DraftRegion,
  asm: DoorAssembly,
): Record<string, unknown> {
  const common = {
    id: region.id,
    seed: region.seed,
    placement: zeroPlacement(),
  };
  if (region.algorithm === "cave") {
    return {
      ...common,
      class: "field-organic",
      algorithm: "cave",
      params: { mouths: region.knobs.mouths },
    };
  }
  const doors = asm.doors.get(region.id) ?? [];
  if (region.algorithm === "hall") {
    return {
      ...common,
      class: "grid-built",
      algorithm: "hall",
      params: { size: region.knobs.size, pillars: region.knobs.pillars, doors },
    };
  }
  return {
    ...common,
    class: "grid-built",
    algorithm: "maze",
    params: { cells: region.knobs.cells, braid: region.knobs.braid, doors },
  };
}

/**
 * Compile the draft into a WorldSpec (structural). Doors on grid regions are ASSEMBLED
 * here: walking regions in order, each attachment appends its parent-side spot to the
 * parent's door list and its child-side spot to the child's — append order IS portal
 * indexing, and connectors are emitted in the same walk, so indices can never drift.
 * Connector `a` = parent, `b` = child (the derivable end).
 *
 * Throws setup-loud on structural errors (duplicate spots, bad mouths, missing parents,
 * illegal kinds, empty draft, dangling start).
 *
 * KNOWN LIMITATION (acceptable at W3): a single UNATTACHED grid anchor assembles no
 * doors → no portal 0 → the engine's spawn derivation fails loud at generate time
 * ("start region … has no portal 0"). A one-region cave world works (mouths are
 * portals). The message says exactly what is missing, so this is left to the engine
 * rather than pre-empted here.
 */
export function draftToSpec(draft: WorldDraft): WorldSpecLike {
  if (draft.regions.length === 0) throw new Error("world draft: no regions");
  if (!draft.regions.some((r) => r.id === draft.startRegionId)) {
    throw new Error(
      `world draft: start region ${draft.startRegionId || "(unset)"} is not in the draft`,
    );
  }
  const byId = new Map(draft.regions.map((r) => [r.id, r]));
  const order = new Map(draft.regions.map((r, i) => [r.id, i]));
  const asm: DoorAssembly = { doors: new Map(), claimed: new Set() };

  const connectors: Record<string, unknown>[] = [];
  for (const region of draft.regions) {
    const att = region.attachment;
    if (!att) continue;
    const parent = byId.get(att.parentId);
    if (!parent) throw new Error(`world draft: unknown parent ${att.parentId}`);
    if ((order.get(att.parentId) ?? 0) >= (order.get(region.id) ?? 0)) {
      throw new Error(
        `world draft: parent ${att.parentId} must precede ${region.id}`,
      );
    }
    if (!legalKinds(parent.algorithm, region.algorithm).includes(att.kind)) {
      throw new Error(
        `world draft: ${att.kind} cannot join ${parent.algorithm} -> ${region.algorithm}`,
      );
    }
    const aIdx = portalIndexOf(asm, parent, att.parentPortal);
    const bIdx = portalIndexOf(asm, region, att.childPortal);
    connectors.push({
      id: `${region.id}-join`,
      kind: att.kind,
      a: [att.parentId, aIdx],
      b: [region.id, bIdx],
      seed: `${draft.name}:${region.id}-join`,
      ...(att.kind === "corridor" && att.params ? { params: att.params } : {}),
    });
  }

  return {
    name: draft.name,
    regions: draft.regions.map((r) => regionSpec(r, asm)),
    connectors,
    startRegion: draft.startRegionId,
  };
}
