import { expect, test } from "bun:test";
import { classifyDrag } from "../../src/viewport-host/input-map.ts";

test("plain left = select/gizmo; alt+left = orbit; shift+alt+left = pan", () => {
  expect(classifyDrag({ button: 0, altKey: false, shiftKey: false })).toBe(
    "select",
  );
  expect(classifyDrag({ button: 0, altKey: true, shiftKey: false })).toBe(
    "orbit",
  );
  expect(classifyDrag({ button: 0, altKey: true, shiftKey: true })).toBe("pan");
  expect(classifyDrag({ button: 1, altKey: false, shiftKey: false })).toBe(
    "orbit",
  ); // middle
});
