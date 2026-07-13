import { expect, test } from "bun:test";
import {
  addRegion,
  bumpRegionSeed,
  bumpSeed,
  canRemove,
  DEFAULT_KNOBS,
  type DraftRegion,
  draftToSpec,
  legalKinds,
  nextRegionId,
  removeRegion,
  type WorldDraft,
} from "../src/frontend/lib/world-draft.ts";

const empty = (): WorldDraft => ({ name: "w", regions: [], startRegionId: "" });

const hallRegion = (
  id: string,
  attachment?: DraftRegion["attachment"],
): DraftRegion => ({
  id,
  algorithm: "hall",
  knobs: DEFAULT_KNOBS.hall,
  seed: id,
  attachment,
});

/** The gate-world shape as a draft: hall-a ⟶corridor⟶ maze-1; maze-1 ⟶aperture⟶ hall-b;
 *  maze-1 ⟶collar-bore⟶ cave-c. */
function gateDraft(): WorldDraft {
  let d = addRegion(empty(), hallRegion("hall-a"));
  d = addRegion(d, {
    id: "maze-1",
    algorithm: "maze",
    knobs: { cells: [4, 4], braid: 0.15 },
    seed: "maze-1",
    attachment: {
      kind: "corridor",
      parentId: "hall-a",
      parentPortal: { wall: "north", offset: 3 },
      childPortal: { wall: "south", offset: 1 },
      params: { length: 6, deltaY: 1.5 },
    },
  });
  d = addRegion(
    d,
    hallRegion("hall-b", {
      kind: "aperture",
      parentId: "maze-1",
      parentPortal: { wall: "west", offset: 2 },
      childPortal: { wall: "east", offset: 2 },
    }),
  );
  d = addRegion(d, {
    id: "cave-c",
    algorithm: "cave",
    knobs: { mouths: 1 },
    seed: "cave-c",
    attachment: {
      kind: "collar-bore",
      parentId: "maze-1",
      parentPortal: { wall: "east", offset: 2 },
      childPortal: { mouth: 0 },
    },
  });
  return d;
}

test("legalKinds: the class-pair matrix, incl. the empty cave->grid cell (refinement 2)", () => {
  expect(legalKinds("hall", "maze")).toEqual(["corridor", "aperture"]);
  expect(legalKinds("maze", "cave")).toEqual(["collar-bore"]);
  expect(legalKinds("cave", "cave")).toEqual(["organic-tunnel"]);
  expect(legalKinds("cave", "hall")).toEqual([]);
});

test("addRegion: anchor first (no attachment), attachments required + validated after", () => {
  const d0 = empty();
  expect(() =>
    addRegion(
      d0,
      hallRegion("hall-1", {
        kind: "corridor",
        parentId: "nope",
        parentPortal: { wall: "north", offset: 0 },
        childPortal: { wall: "south", offset: 0 },
      }),
    ),
  ).toThrow(/anchor/);
  const d1 = addRegion(d0, hallRegion("hall-1"));
  expect(d1.startRegionId).toBe("hall-1"); // first region becomes the default start
  expect(() => addRegion(d1, hallRegion("hall-2"))).toThrow(/attachment/);
  expect(() =>
    addRegion(d1, {
      id: "cave-1",
      algorithm: "cave",
      knobs: { mouths: 1 },
      seed: "cave-1",
      attachment: {
        kind: "corridor", // illegal: corridor cannot reach a cave
        parentId: "hall-1",
        parentPortal: { wall: "north", offset: 0 },
        childPortal: { mouth: 0 },
      },
    }),
  ).toThrow(/cannot join/);
});

test("nextRegionId survives removals (max-suffix, not count)", () => {
  let d = addRegion(empty(), hallRegion("hall-1"));
  d = addRegion(
    d,
    hallRegion("hall-2", {
      kind: "aperture",
      parentId: "hall-1",
      parentPortal: { wall: "north", offset: 2 },
      childPortal: { wall: "south", offset: 2 },
    }),
  );
  d = removeRegion(d, "hall-2");
  expect(nextRegionId(d, "hall")).toBe("hall-2"); // max existing suffix is 1
  expect(nextRegionId(gateDraft(), "hall")).toBe("hall-1"); // ids hall-a/hall-b carry no numeric suffix
});

test("canRemove/removeRegion: leaf-only; start falls back to the first region", () => {
  const d = gateDraft();
  expect(canRemove(d, "maze-1")).toBe(false); // hall-b + cave-c attach to it
  expect(canRemove(d, "hall-a")).toBe(false); // maze-1 attaches to it
  expect(canRemove(d, "cave-c")).toBe(true);
  expect(() => removeRegion(d, "maze-1")).toThrow(/leaves/);
  const d2 = removeRegion(d, "cave-c");
  expect(d2.regions.map((r) => r.id)).toEqual(["hall-a", "maze-1", "hall-b"]);
  // Removing the start region reparks the start on the first region.
  const d3 = { ...d2, startRegionId: "hall-b" };
  expect(removeRegion(d3, "hall-b").startRegionId).toBe("hall-a");
});

test("bumpSeed / bumpRegionSeed: the -N reroll convention", () => {
  expect(bumpSeed("maze-1")).toBe("maze-2"); // trailing -N bumps
  expect(bumpSeed("cavern")).toBe("cavern-2");
  const d = bumpRegionSeed(gateDraft(), "cave-c");
  expect(d.regions.find((r) => r.id === "cave-c")?.seed).toBe("cave-c-2"); // no trailing -N → append
  expect(d.regions.find((r) => r.id === "maze-1")?.seed).toBe("maze-1"); // untouched
});

test("draftToSpec: doors assemble in encounter order; connectors reference the right indices", () => {
  const spec = draftToSpec(gateDraft());
  expect(spec.startRegion).toBe("hall-a");
  expect(spec.regions.map((r) => (r as { id: string }).id)).toEqual([
    "hall-a",
    "maze-1",
    "hall-b",
    "cave-c",
  ]);
  // maze-1's doors: own childPortal (south) first, then hall-b's parent spot (west),
  // then cave-c's parent spot (east) — encounter order IS portal indexing.
  const maze = spec.regions[1] as {
    params: { doors: { wall: string; offset: number }[] };
  };
  expect(maze.params.doors).toEqual([
    { wall: "south", offset: 1 },
    { wall: "west", offset: 2 },
    { wall: "east", offset: 2 },
  ]);
  const kinds = spec.connectors.map((c) => (c as { kind: string }).kind);
  expect(kinds).toEqual(["corridor", "aperture", "collar-bore"]);
  const [corr, ap, bore] = spec.connectors as {
    a: [string, number];
    b: [string, number];
    params?: unknown;
  }[];
  expect(corr?.a).toEqual(["hall-a", 0]);
  expect(corr?.b).toEqual(["maze-1", 0]);
  expect(corr?.params).toEqual({ length: 6, deltaY: 1.5 });
  expect(ap?.a).toEqual(["maze-1", 1]); // west appended second on maze-1
  expect(ap?.b).toEqual(["hall-b", 0]);
  expect(bore?.a).toEqual(["maze-1", 2]); // east appended third
  expect(bore?.b).toEqual(["cave-c", 0]); // mouth index passes through
  // Every region carries the zero placement (anchor = explicit origin; rest derived).
  for (const r of spec.regions) {
    expect((r as { placement: unknown }).placement).toEqual({
      translation: [0, 0, 0],
      yaw: 0,
    });
  }
});

test("draftToSpec: duplicate portal spots and out-of-range mouths throw", () => {
  let d = addRegion(empty(), hallRegion("hall-1"));
  d = addRegion(
    d,
    hallRegion("hall-2", {
      kind: "aperture",
      parentId: "hall-1",
      parentPortal: { wall: "north", offset: 2 },
      childPortal: { wall: "south", offset: 2 },
    }),
  );
  d = addRegion(
    d,
    hallRegion("hall-3", {
      kind: "aperture",
      parentId: "hall-1",
      parentPortal: { wall: "north", offset: 2 }, // same spot as hall-2's parent side
      childPortal: { wall: "south", offset: 2 },
    }),
  );
  expect(() => draftToSpec(d)).toThrow(/used twice/);

  let c = addRegion(empty(), {
    id: "cave-1",
    algorithm: "cave",
    knobs: { mouths: 1 },
    seed: "s",
  } as DraftRegion);
  c = addRegion(c, {
    id: "cave-2",
    algorithm: "cave",
    knobs: { mouths: 1 },
    seed: "s2",
    attachment: {
      kind: "organic-tunnel",
      parentId: "cave-1",
      parentPortal: { mouth: 2 }, // cave-1 has 1 mouth
      childPortal: { mouth: 0 },
    },
  });
  expect(() => draftToSpec(c)).toThrow(/mouth 2 outside/);
  expect(() => draftToSpec(empty())).toThrow(/no regions/);
});
