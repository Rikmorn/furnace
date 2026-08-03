import { expect, test } from "bun:test";
import { bowlingSetupDoc } from "../../tests/scene/_fixtures/bowling-setup.ts";
import { registerBuiltins } from "./builtins.ts";
import { resetRegistryForTests } from "./registry.ts";
import { validateDocument } from "./validate.ts";

test("a code-built scene round-trips through JSON serialize→parse + validates", () => {
  resetRegistryForTests();
  registerBuiltins();
  const doc = bowlingSetupDoc();
  const round = JSON.parse(`${JSON.stringify(doc, null, 2)}\n`);
  expect(round).toEqual(doc);
  expect(() => validateDocument(round)).not.toThrow();
});
