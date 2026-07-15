import { describe, expect, test } from "bun:test";
import { isFieldManifest } from "../src/field-world.ts";

// One Field · F1 Task 11: the v2 field-manifest gate. `world-loader.loadWorld` fetches ONE
// `manifest.json` for both world classes, so the (version:2, kind:"field") discriminant is the
// only thing that routes a bake to the field loader instead of the v1 `assertCompatible` path.
describe("field manifest gate", () => {
  test("accepts v2 field manifests, rejects everything else", () => {
    expect(isFieldManifest({ version: 2, kind: "field" })).toBe(true);
    // v1 region manifest: no kind, version 1.
    expect(isFieldManifest({ version: 1 })).toBe(false);
    // Right kind, wrong (future) version.
    expect(isFieldManifest({ version: 3, kind: "field" })).toBe(false);
    // Right version, wrong kind.
    expect(isFieldManifest({ version: 2, kind: "region" })).toBe(false);
    expect(isFieldManifest(null)).toBe(false);
    expect(isFieldManifest("nope")).toBe(false);
    expect(isFieldManifest(undefined)).toBe(false);
    expect(isFieldManifest(42)).toBe(false);
  });
});
