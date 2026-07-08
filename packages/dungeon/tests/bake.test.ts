import { describe, expect, test } from "bun:test";
import { validateDocument } from "@furnace/core/scene";
import {
  type BakeFile,
  bakeWing,
  WING_DIR,
  type WingManifest,
} from "../src/bake.ts";

// The winning derived seed for this config (found empirically: first `bake-31-N` that
// places on attempt 0 AND carries a cave — Task 7 reuses it). `bake-fail-0` fails
// placement at a tiny budget so bakeWing's attempt-0 assertion throws.
const SEED = "bake-31-1";
const CFG = {
  sectors: [1, 1] as [number, number],
  targetRooms: 4,
  loopChance: 0,
};

function manifestOf(files: BakeFile[]): WingManifest {
  const f = files.find((x) => x.path === `${WING_DIR}/manifest.json`);
  return JSON.parse(f?.contents as string) as WingManifest;
}
function docOf(
  files: BakeFile[],
  file: string,
): {
  entities: { components: Record<string, unknown> }[];
  resources: { geometries: Record<string, { kind: string }> };
} {
  const f = files.find((x) => x.path === file);
  return JSON.parse(f?.contents as string);
}

describe("bakeWing", () => {
  test("emits manifest + one doc per non-authored region + connectors, deterministically", () => {
    const a = bakeWing(SEED, CFG, {});
    const b = bakeWing(SEED, CFG, {});
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
    // Full content determinism (same engine → byte-identical): string docs/manifest
    // compared as text, `.fmesh` compared as bytes. Catches a vertex-order or
    // non-manifest-field regression the path/manifest-only checks would miss.
    const normalize = (files: BakeFile[]) =>
      files.map((f) => ({
        path: f.path,
        contents:
          typeof f.contents === "string" ? f.contents : Array.from(f.contents),
      }));
    expect(normalize(a.files)).toEqual(normalize(b.files));

    const manifest = manifestOf(a.files);
    expect(manifest.version).toBe(1);
    expect(manifest.provenance.seed).toBe(SEED);
    expect(manifest.regions.length).toBeGreaterThanOrEqual(2); // cave + >=1 room

    const cave = manifest.regions.find((r) => r.theme === "cave");
    expect(cave).toBeDefined();
    expect(cave?.themeParams).toBeDefined();
    // pillarHall entries must carry their graph-derived doors — a bare re-run without
    // them reproduces a DIFFERENT room (the 3.1-gate blocked-doorways bug).
    for (const hall of manifest.regions.filter(
      (r) => r.theme === "pillarHall",
    )) {
      expect(hall.themeParams?.["doors"]).toBeDefined();
    }

    // Every region doc is render-only (no rigidBody component); manifest colliders are
    // cuboid-only (voxels regenerate at load, never serialize).
    for (const r of manifest.regions) {
      const doc = docOf(a.files, r.file);
      for (const e of doc.entities) {
        expect(e.components["rigidBody"]).toBeUndefined();
      }
      for (const c of r.colliders) expect("cuboid" in c.shape).toBe(true);
    }

    // The cave's custom (Surface-Nets) isosurface is doc-entity index 0 → the
    // `<id>-0.fmesh` sidecar assumption Task 6's wing-loader depends on.
    const caveDoc = docOf(a.files, cave?.file as string);
    const firstGeoRef = (
      caveDoc.entities[0]?.components["meshRenderer"] as { geometry: string }
    ).geometry;
    expect(firstGeoRef).toBe("g_mesh_0");
    expect(caveDoc.resources.geometries["g_mesh_0"]?.kind).toBe("mesh");
    expect(
      a.files.some((f) => f.path === `${WING_DIR}/${cave?.id}-0.fmesh`),
    ).toBe(true);

    // Every baked scene doc validates against the core loader schema — proves the docs
    // are loadable (de-risks Task 6/7). @furnace/core/scene auto-registers built-ins on
    // import; validateDocument does no fetch, so the mesh sidecar refs validate here.
    for (const f of a.files) {
      if (!f.path.endsWith(".scene.json")) continue;
      expect(() =>
        validateDocument(JSON.parse(f.contents as string)),
      ).not.toThrow();
    }
  });

  test("throws when the seed does not place on attempt 0", () => {
    expect(() => bakeWing("bake-fail-0", CFG, { maxAttempts: 50 })).toThrow();
  });

  test("bakes under regions/<name> when a wing name is given", () => {
    const { files } = bakeWing(SEED, CFG, {}, "my-wing");
    expect(files.every((f) => f.path.startsWith("regions/my-wing/"))).toBe(
      true,
    );
  });

  test("rejects a path-hostile wing name setup-loud", () => {
    expect(() => bakeWing(SEED, CFG, {}, "../escape")).toThrow(/wing name/);
    expect(() => bakeWing(SEED, CFG, {}, "")).toThrow(/wing name/);
    expect(() => bakeWing(SEED, CFG, {}, "has space")).toThrow(/wing name/);
  });
});
