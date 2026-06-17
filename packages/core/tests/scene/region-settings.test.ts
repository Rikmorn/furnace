import { beforeEach, expect, test } from "bun:test";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import { resetRegistryForTests } from "../../src/scene/registry.ts";
import { validateDocument } from "../../src/scene/validate.ts";

beforeEach(() => {
  resetRegistryForTests();
  registerBuiltins();
});

test("settings accepts a region block (provenance/theme/origin)", () => {
  expect(() =>
    validateDocument({
      version: 1,
      settings: {
        region: {
          provenance: {
            generatorId: "dungeon",
            generatorVersion: 1,
            seed: "s",
            kind: "cavern",
          },
          theme: "damp-stone",
          origin: [0, 0, -24],
        },
      },
      entities: [
        {
          id: "cam",
          components: {
            transform: {},
            camera: { kind: "perspective", aspect: 1 },
          },
        },
      ],
    } as never),
  ).not.toThrow();
});

test("settings rejects an unknown region field (strict)", () => {
  expect(() =>
    validateDocument({
      version: 1,
      settings: { region: { bogus: true } },
      entities: [
        {
          id: "cam",
          components: {
            transform: {},
            camera: { kind: "perspective", aspect: 1 },
          },
        },
      ],
    } as never),
  ).toThrow();
});
