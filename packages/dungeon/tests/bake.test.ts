import { describe, expect, test } from "bun:test";
import { bakeWorld, type WorldManifest } from "../src/world/bake.ts";
import { HALL_CAVE } from "./_helpers/world-fixtures.ts";

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
    // Recorded re-expansion inputs (never re-derived from constants at load):
    // the collar-bore carries its built-shell band extension; organic tunnels
    // stay clipped at both planes.
    expect(bore?.kind === "collar-bore" && bore.extendA).toBe(0.5);
  });
});
