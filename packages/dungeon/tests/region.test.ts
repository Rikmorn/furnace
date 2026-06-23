import { expect, test } from "bun:test";
import { type ThemeName, themes } from "../src/region.ts";

test("the registry exposes the three planned themes", () => {
  const names: ThemeName[] = ["cave", "pillarHall", "greatHall"];
  for (const n of names) expect(typeof themes[n]).toBe("function");
});
