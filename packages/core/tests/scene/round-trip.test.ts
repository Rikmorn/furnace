import { expect, test } from "bun:test";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import { resetRegistryForTests } from "../../src/scene/registry.ts";
import { validateDocument } from "../../src/scene/validate.ts";
import { bowlingSetupDoc } from "./_fixtures/bowling-setup.ts";

test("a code-built scene round-trips through JSON serialize→parse + validates", () => {
  resetRegistryForTests();
  registerBuiltins();
  const doc = bowlingSetupDoc();
  const round = JSON.parse(`${JSON.stringify(doc, null, 2)}\n`);
  expect(round).toEqual(doc);
  expect(() => validateDocument(round)).not.toThrow();
});
