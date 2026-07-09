import { expect, test } from "bun:test";
import { classifyDrag } from "../../src/viewport-host/input-map.ts";

test("classifyDrag: RMB = fly, MMB = pan, Alt+LMB = orbit, plain LMB = select", () => {
  expect(classifyDrag({ button: 2, altKey: false, shiftKey: false })).toBe(
    "fly",
  );
  expect(classifyDrag({ button: 1, altKey: false, shiftKey: false })).toBe(
    "pan",
  );
  expect(classifyDrag({ button: 0, altKey: true, shiftKey: false })).toBe(
    "orbit",
  );
  expect(classifyDrag({ button: 0, altKey: false, shiftKey: false })).toBe(
    "select",
  );
});

test("classifyDrag: Alt+Shift+LMB = pan (secondary pan binding)", () => {
  expect(classifyDrag({ button: 0, altKey: true, shiftKey: true })).toBe("pan");
});
