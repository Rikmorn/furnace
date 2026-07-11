// packages/dungeon/tests/bake-world.test.ts
import { describe, expect, test } from "bun:test";
import { type BakeFile, bakeWorld, worldDir } from "../src/bake.ts";
import { TUNNEL_OVERSHOOT, TUNNEL_RADIUS } from "../src/connector.ts";
import type { Aabb, Connection, Vec3 } from "../src/region.ts";
import { realizeWorldSpec } from "../src/world-build.ts";
import { DEFAULT_WORLD } from "../src/world-spec.ts";

type WorldManifestJson = {
  playerStart: Vec3;
  playerYaw: number;
  regions: {
    id: string;
    placement: { translation: Vec3; yaw: number };
    cuboids: unknown[];
  }[];
  connectors: {
    id: string;
    a: Connection;
    b: Connection;
    radius: number;
    overshoot: number;
  }[];
};

const manifestOf = (files: BakeFile[]): WorldManifestJson =>
  JSON.parse(files[files.length - 1]?.contents as string) as WorldManifestJson;

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

  // (iii) playerStart lands inside cave-a's placed bounds, and both region entries carry
  // real (non-empty) cuboid colliders (the caves' collar/plug boxes; voxels never serialize).
  test("manifest playerStart is inside cave-a's placed bounds; regions carry cuboids", () => {
    const manifest = manifestOf(bakeWorld(DEFAULT_WORLD));

    const caveA = realizeWorldSpec(DEFAULT_WORLD).regions.get("cave-a");
    if (!caveA) throw new Error("missing placed cave-a");
    expect(insideAabb(caveA.bounds, manifest.playerStart)).toBe(true);

    expect(manifest.regions.length).toBe(2);
    for (const r of manifest.regions) {
      expect(r.cuboids.length).toBeGreaterThan(0);
    }
  });

  // (v) Contract lock: the manifest bakes the DERIVED region placement and the PLACED connector
  // portals — not the raw spec placeholders / unplaced local portals. This is exactly the data
  // Task 6 re-expands from, so it is asserted against `realizeWorldSpec` as the oracle. It fails
  // if bakeWorld regresses to `region.placement` (cave-b's [0,0,0]) or unplaced portals.
  test("bakes cave-b's DERIVED placement + the connector's PLACED portals + tunnel opts", () => {
    const manifest = manifestOf(bakeWorld(DEFAULT_WORLD));
    const realized = realizeWorldSpec(DEFAULT_WORLD);

    // cave-b's placement is join-derived, NOT the [0,0,0] spec placeholder.
    const caveB = manifest.regions.find((r) => r.id === "cave-b");
    const derivedB = realized.spec.regions.find((r) => r.id === "cave-b");
    if (!caveB || !derivedB) throw new Error("missing cave-b entry");
    expect(caveB.placement.translation).not.toEqual([0, 0, 0]);
    expect(caveB.placement).toEqual(derivedB.placement);

    // The one connector's a/b are the PLACED world-frame portals (what organicTunnel consumed),
    // and its opts are the TUNNEL_* defaults Task 3 built it with.
    const conn = manifest.connectors[0];
    const placedA = realized.regions.get("cave-a")?.connections[0];
    const placedB = realized.regions.get("cave-b")?.connections[0];
    if (!conn || !placedA || !placedB)
      throw new Error("missing connector data");
    expect(conn.a).toEqual(placedA);
    expect(conn.b).toEqual(placedB);
    expect(conn.radius).toBe(TUNNEL_RADIUS);
    expect(conn.overshoot).toBe(TUNNEL_OVERSHOOT);
  });

  // (vi) A path-hostile name is refused setup-loud (FS/URL-safety + daemon root-containment).
  test("rejects a path-hostile world name setup-loud", () => {
    expect(() => bakeWorld(DEFAULT_WORLD, "../evil")).toThrow(/world name/);
    expect(() => bakeWorld(DEFAULT_WORLD, "has space")).toThrow(/world name/);
  });
});
