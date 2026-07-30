import { expect, test } from "bun:test";
import {
  type EditorState,
  initialState,
  reduce,
} from "../src/frontend/lib/state.ts";

test("boot happy path: booting → engine-ready", () => {
  expect(initialState.status).toBe("booting");
  expect(initialState.error).toBeUndefined();
  const s: EditorState = reduce(initialState, { type: "engine-ready" });
  expect(s.status).toBe("ready");
  expect(s.error).toBeUndefined();
});

test("engine build failure is a terminal chrome-alive state with diagnostics", () => {
  const s = reduce(initialState, {
    type: "engine-error",
    diagnostics: "x.ts:3 Could not resolve",
  });
  expect(s.status).toBe("engine-error");
  expect(s.error).toContain("Could not resolve");
});

test("no-webgpu is its own state", () => {
  const s = reduce(initialState, { type: "no-webgpu" });
  expect(s.status).toBe("no-webgpu");
});
