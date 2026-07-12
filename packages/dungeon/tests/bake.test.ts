import { describe, expect, test } from "bun:test";
import { validateDocument } from "@furnace/core/scene";
import {
  type BakeFile,
  bakeWing,
  bakeWorld,
  WING_DIR,
  type WingManifest,
  type WorldManifest,
} from "../src/bake.ts";
import { HALL_CAVE } from "./_helpers/world-fixtures.ts";

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
  entities: { id: string; components: Record<string, unknown> }[];
  resources: { geometries: Record<string, { kind: string }> };
} {
  const f = files.find((x) => x.path === file);
  return JSON.parse(f?.contents as string);
}

describe("bakeWing", () => {
  test("emits ONE merged wing.scene.json + manifest (manifest LAST), deterministically", () => {
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

    // ONE scene doc for the whole wing, referenced from the manifest.
    expect(manifest.scene).toBe(`${WING_DIR}/wing.scene.json`);
    const sceneDocs = a.files.filter((f) => f.path.endsWith(".scene.json"));
    expect(sceneDocs.length).toBe(1);
    expect(sceneDocs[0]?.path).toBe(manifest.scene);

    // manifest.json is the LAST file — the crash-safety contract (spec §2.2):
    // an interrupted write leaves no manifest → loader falls back to live gen.
    expect(a.files[a.files.length - 1]?.path).toBe(`${WING_DIR}/manifest.json`);

    // Per-entry file fields are gone (v1 shape change, D6 — no version bump).
    expect("file" in (manifest.regions[0] as object)).toBe(false);

    const doc = docOf(a.files, manifest.scene);
    // Every baked entity is render-only (no rigidBody component); manifest colliders are
    // cuboid-only (voxels regenerate at load, never serialize).
    for (const e of doc.entities) {
      expect(e.components["rigidBody"]).toBeUndefined();
    }
    for (const r of manifest.regions)
      for (const c of r.colliders) expect("cuboid" in c.shape).toBe(true);

    // Resource keys are piece-prefixed → no collisions in the merged doc.
    const geoKeys = Object.keys(doc.resources.geometries);
    expect(new Set(geoKeys).size).toBe(geoKeys.length);
    // Entities from BOTH regions and connectors live in the one doc.
    const ids = doc.entities.map((e) => e.id);
    expect(ids.some((i) => i.startsWith("connector-"))).toBe(true);
    for (const r of manifest.regions) {
      expect(ids.some((i) => i.startsWith(`${r.id}-m`))).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
    // The cave's isosurface geometry ref is piece-prefixed now; its `.fmesh` sidecar path
    // is UNCHANGED (`<id>-0.fmesh`) — the wing-loader depends on it (mesh index 0).
    expect(doc.resources.geometries[`${cave?.id}-g_mesh_0`]?.kind).toBe("mesh");
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

  test("a deadline in the budget never reaches the bake (replay is counted-only)", () => {
    // deadlineMs: 0 would fail ANY placement instantly if it reached buildWorld.
    const { files } = bakeWing(SEED, CFG, { deadlineMs: 0 });
    expect(files.length).toBeGreaterThan(0);
  });
});

describe("bakeWorld (grid class)", () => {
  test("grid region: manifest entry present, no sidecars, no scene entities", () => {
    const files = bakeWorld(HALL_CAVE);
    const manifest = JSON.parse(
      files[files.length - 1]?.contents as string,
    ) as WorldManifest;
    const hallEntry = manifest.regions.find((r) => r.id === "hall-a");
    expect(hallEntry?.class).toBe("grid-built");
    expect(hallEntry?.cuboids).toEqual([]);
    // No hall sidecars (grid render re-expands); the bore's .fmesh DOES exist.
    expect(
      files.some((f) => f.path.includes("hall-a") && f.path.endsWith(".fmesh")),
    ).toBe(false);
    expect(
      files.some((f) => f.path.includes("bore-1") && f.path.endsWith(".fmesh")),
    ).toBe(true);
    const scene = JSON.parse(
      files.find((f) => f.path.endsWith("world.scene.json"))
        ?.contents as string,
    ) as { entities: { id: string }[] };
    expect(scene.entities.some((e) => e.id.startsWith("hall-a"))).toBe(false);
    // Connector entries carry endpoint refs for load-side mutation grouping:
    const bore = manifest.connectors.find((c) => c.id === "bore-1");
    expect(bore?.aRef).toEqual(["hall-a", 0]);
  });
});
