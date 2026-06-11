import { expect, test } from "bun:test";
import type { SceneDocument } from "@furnace/core/scene";
import * as mutations from "../src/daemon/mutations.ts";

function doc(): SceneDocument {
  return {
    version: 1,
    resources: { geometries: { g: { kind: "cube" } } },
    entities: [
      { id: "cube", components: { transform: {} } },
      { id: "entity-1", components: {} },
    ],
  };
}

// bun:test's toThrow doesn't take matchers; capture the thrown value and
// toMatchObject it instead (the async sites use rejects.toMatchObject).
function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected function to throw");
}

test("addEntity with explicit id", () => {
  const d = doc();
  expect(
    mutations.addEntity(d, { id: "lamp", components: { transform: {} } }),
  ).toBe("lamp");
  expect(d.entities.at(-1)).toEqual({
    id: "lamp",
    components: { transform: {} },
  });
});

test("addEntity auto-generates the first free entity-N id", () => {
  const d = doc(); // entity-1 is taken
  expect(mutations.addEntity(d, {})).toBe("entity-2");
  expect(d.entities.at(-1)).toEqual({ id: "entity-2", components: {} });
});

test("addEntity rejects a duplicate id", () => {
  expect(
    captureError(() => mutations.addEntity(doc(), { id: "cube" })),
  ).toMatchObject({ code: "validation-failed" });
});

test("removeEntity removes; missing target rejects", () => {
  const d = doc();
  mutations.removeEntity(d, "cube");
  expect(d.entities.map((e) => e.id)).toEqual(["entity-1"]);
  expect(captureError(() => mutations.removeEntity(d, "ghost"))).toMatchObject({
    code: "validation-failed",
  });
});

test("setComponent add-or-replaces; removeComponent requires presence", () => {
  const d = doc();
  mutations.setComponent(d, "cube", "fixtureGlow", { intensity: 2 });
  expect(d.entities[0]?.components["fixtureGlow"]).toEqual({ intensity: 2 });
  mutations.removeComponent(d, "cube", "fixtureGlow");
  expect(d.entities[0]?.components["fixtureGlow"]).toBeUndefined();
  expect(
    captureError(() => mutations.removeComponent(d, "cube", "fixtureGlow")),
  ).toMatchObject({ code: "validation-failed" });
  expect(
    captureError(() => mutations.setComponent(d, "ghost", "transform", {})),
  ).toMatchObject({ code: "validation-failed" });
});

test("setResource creates tables on demand; removeResource requires presence", () => {
  const d = doc();
  mutations.setResource(d, "shaders", "s", { kind: "unlit" });
  expect(d.resources?.shaders?.["s"]).toEqual({ kind: "unlit" });
  mutations.removeResource(d, "geometries", "g");
  expect(d.resources?.geometries?.["g"]).toBeUndefined();
  expect(
    captureError(() => mutations.removeResource(d, "materials", "nope")),
  ).toMatchObject({ code: "validation-failed" });
});

test("setSettings replaces the whole settings object", () => {
  const d = doc();
  mutations.setSettings(d, { clearColor: [1, 0, 0, 1] });
  expect(d.settings).toEqual({ clearColor: [1, 0, 0, 1] });
});
