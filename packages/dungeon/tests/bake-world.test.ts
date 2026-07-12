// packages/dungeon/tests/bake-world.test.ts
import { describe, expect, test } from "bun:test";
import {
  type BakeFile,
  bakeWorld,
  type WorldConnectorEntry,
  type WorldManifest,
  worldDir,
} from "../src/bake.ts";
import { TUNNEL_OVERSHOOT, TUNNEL_RADIUS } from "../src/connector.ts";
import type { Aabb, Connection, Vec3 } from "../src/region.ts";
import { realizeWorldSpec } from "../src/world-build.ts";
import { DEFAULT_WORLD } from "../src/world-spec.ts";
import { TWO_CAVES } from "./_helpers/world-fixtures.ts";

// The REAL manifest type, not a hand-rolled local mirror: the gate world's manifest is a
// discriminated union (region `class`, connector `kind`), and a local copy silently drifts out
// of sync with bake.ts — it did, which is how the connector `kind` field went untested until
// Task 14 needed it.
const manifestOf = (files: BakeFile[]): WorldManifest =>
  JSON.parse(files[files.length - 1]?.contents as string) as WorldManifest;

const DIR = worldDir(DEFAULT_WORLD.name); // "worlds/default"

function insideAabb(box: Aabb, p: Vec3): boolean {
  return (
    p[0] >= box.min[0] &&
    p[0] <= box.max[0] &&
    p[1] >= box.min[1] &&
    p[1] <= box.max[1] &&
    p[2] >= box.min[2] &&
    p[2] <= box.max[2]
  );
}

/** The realized world's placed portal at `[regionId, portalIndex]` — the oracle a baked
 *  connector's `a`/`b` must equal. Throws (rather than yielding `undefined`, which `toEqual`
 *  would happily compare against a missing baked field) if the portal is not there. */
function placedPortal(
  realized: ReturnType<typeof realizeWorldSpec>,
  regionId: string,
  portalIndex: number,
): Connection {
  const portal = realized.regions.get(regionId)?.connections[portalIndex];
  if (!portal) throw new Error(`no placed portal ${regionId}:${portalIndex}`);
  return portal;
}

/** Assert a connector entry is a BORE kind carrying the `TUNNEL_*` opts it was built with.
 *  The `"radius" in c` check is what narrows `WorldConnectorEntry` to its bore branch: testing
 *  `c.kind !== "collar-bore"` cannot, since an `organic-tunnel` is also a bore. */
function expectBoreOpts(c: WorldConnectorEntry): void {
  if (!("radius" in c)) throw new Error(`connector ${c.id} baked no bore opts`);
  expect(c.radius).toBe(TUNNEL_RADIUS);
  expect(c.overshoot).toBe(TUNNEL_OVERSHOOT);
}

// Byte-comparable view of a file set: strings as-is, `.fmesh` bytes as number arrays.
const normalize = (files: BakeFile[]) =>
  files.map((f) => ({
    path: f.path,
    contents:
      typeof f.contents === "string" ? f.contents : Array.from(f.contents),
  }));

describe("bakeWorld", () => {
  // (i) manifest is LAST; every other emitted path lives under worlds/<name>/.
  test("emits under worlds/<name>/ with manifest.json LAST", () => {
    const files = bakeWorld(DEFAULT_WORLD);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f.path.startsWith(`${DIR}/`)).toBe(true);

    const last = files[files.length - 1];
    expect(last?.path).toBe(`${DIR}/manifest.json`);
    // The manifest is the ONLY manifest, and it is genuinely last (crash-safety contract).
    const manifestPaths = files.filter((f) => f.path.endsWith("manifest.json"));
    expect(manifestPaths.length).toBe(1);
  });

  // (ii) Re-bake parity — deterministic: two calls produce byte-identical file sets (same
  // paths in the same order, same contents; `.fmesh` sidecars compared as bytes). The
  // manifest carries NO bakedAt, so a timestamp can't break this.
  test("re-bakes byte-identically (deterministic, no timestamp)", () => {
    const a = bakeWorld(DEFAULT_WORLD);
    const b = bakeWorld(DEFAULT_WORLD);
    expect(a.map((f) => f.path)).toEqual(b.map((f) => f.path));
    expect(normalize(a)).toEqual(normalize(b));

    const manifest = JSON.parse(a[a.length - 1]?.contents as string) as {
      provenance: Record<string, unknown>;
    };
    expect("bakedAt" in manifest.provenance).toBe(false);
  });

  // (iii) playerStart lands inside the start region's (hall-a's) placed bounds, and the
  // per-class cuboid contract holds: a FIELD-ORGANIC region bakes its collar/plug boxes as
  // world-frame cuboids, while a GRID-BUILT region bakes NONE (`cuboids: []` by contract —
  // its collider IS the voxel proxy the loader re-expands, and voxels never serialize).
  test("manifest playerStart is inside hall-a's placed bounds; cuboids follow the class contract", () => {
    const manifest = manifestOf(bakeWorld(DEFAULT_WORLD));

    const hallA = realizeWorldSpec(DEFAULT_WORLD).regions.get("hall-a");
    if (!hallA) throw new Error("missing placed hall-a");
    expect(insideAabb(hallA.bounds, manifest.playerStart)).toBe(true);

    expect(manifest.regions.length).toBe(3);
    const byClass = (c: string) =>
      manifest.regions.filter((r) => r.class === c);
    // Precondition teeth: the gate world really does carry both classes, so neither loop below
    // can pass vacuously.
    expect(byClass("field-organic").length).toBe(1);
    expect(byClass("grid-built").length).toBe(2);
    for (const r of byClass("field-organic")) {
      expect(r.cuboids.length).toBeGreaterThan(0);
    }
    for (const r of byClass("grid-built")) {
      expect(r.cuboids.length).toBe(0);
    }
  });

  // (v) Contract lock: the manifest bakes the DERIVED region placements and the PLACED connector
  // portals — not the raw spec placeholders / unplaced local portals. This is exactly the data
  // the loader re-expands from, so it is asserted against `realizeWorldSpec` as the oracle. It
  // fails if bakeWorld regresses to `region.placement` (the [0,0,0] placeholders) or to unplaced
  // portals. Also locks the connector-entry KIND UNION: a bore kind carries `radius`/`overshoot`,
  // a corridor carries neither.
  test("bakes the DERIVED placements + each connector's PLACED portals + bore-only tunnel opts", () => {
    const manifest = manifestOf(bakeWorld(DEFAULT_WORLD));
    const realized = realizeWorldSpec(DEFAULT_WORLD);

    // hall-b's and cave-c's placements are join-derived, NOT the [0,0,0] spec placeholders.
    for (const id of ["hall-b", "cave-c"]) {
      const baked = manifest.regions.find((r) => r.id === id);
      const derived = realized.spec.regions.find((r) => r.id === id);
      if (!baked || !derived) throw new Error(`missing ${id} entry`);
      expect(baked.placement.translation).not.toEqual([0, 0, 0]);
      expect(baked.placement).toEqual(derived.placement);
    }

    // Each connector's a/b are the PLACED world-frame portals its volume was built from.
    const corridor = manifest.connectors.find((c) => c.id === "corridor-1");
    const bore = manifest.connectors.find((c) => c.id === "bore-1");
    if (!corridor || !bore) throw new Error("missing connector entries");
    expect(corridor.a).toEqual(placedPortal(realized, "hall-a", 0));
    expect(corridor.b).toEqual(placedPortal(realized, "hall-b", 0));
    expect(bore.a).toEqual(placedPortal(realized, "hall-a", 1));
    expect(bore.b).toEqual(placedPortal(realized, "cave-c", 0));

    // Kind union: the collar-bore carries the TUNNEL_* opts it was built with; the corridor,
    // a pure grid join, carries no bore opts at all.
    expect(bore.kind).toBe("collar-bore");
    expect(corridor.kind).toBe("corridor");
    expectBoreOpts(bore);
    expect("radius" in corridor).toBe(false);
    expect("overshoot" in corridor).toBe(false);
  });

  // (vii) ORGANIC-TUNNEL bake entry (TWO_CAVES). The gate world has no organic tunnel, but
  // `bakeWorld` still routes that kind through the bore branch (merged-doc mesh + radius/overshoot).
  // Without this, promoting the gate world would silently drop the only bake coverage of it.
  test("bakes an organic-tunnel world: bore opts + a merged-doc tunnel mesh sidecar", () => {
    const files = bakeWorld(TWO_CAVES);
    const manifest = manifestOf(files);
    const realized = realizeWorldSpec(TWO_CAVES);

    const conn = manifest.connectors[0];
    if (!conn) throw new Error("missing connector entry");
    expect(conn.kind).toBe("organic-tunnel");
    expect(conn.a).toEqual(placedPortal(realized, "cave-a", 0));
    expect(conn.b).toEqual(placedPortal(realized, "cave-b", 0));
    expectBoreOpts(conn);
    // A bore kind contributes its Surface-Nets tube to the merged doc as a `.fmesh` sidecar.
    expect(files.some((f) => f.path.endsWith("tunnel-1-0.fmesh"))).toBe(true);
  });

  // (vi) A path-hostile name is refused setup-loud (FS/URL-safety + daemon root-containment).
  test("rejects a path-hostile world name setup-loud", () => {
    expect(() => bakeWorld(DEFAULT_WORLD, "../evil")).toThrow(/world name/);
    expect(() => bakeWorld(DEFAULT_WORLD, "has space")).toThrow(/world name/);
  });
});
