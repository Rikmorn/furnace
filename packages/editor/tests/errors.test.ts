import { expect, test } from "bun:test";
import {
  EditorError,
  type EditorErrorCode,
  httpStatus,
} from "../src/daemon/errors.ts";

test("EditorError carries a string code and message", () => {
  const err = new EditorError("not-found", 'scene file "x" not found');
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("EditorError");
  expect(err.code).toBe("not-found");
  expect(err.message).toContain("not found");
});

test("httpStatus maps every code to its spec'd status", () => {
  const expected: Record<EditorErrorCode, number> = {
    "invalid-input": 400,
    "invalid-json": 400,
    "validation-failed": 400,
    "unknown-command": 404,
    "not-found": 404,
    "outside-root": 404,
    "no-session": 409,
    "unsaved-changes": 409,
    "nothing-to-undo": 409,
    "nothing-to-redo": 409,
    "already-exists": 409,
    unreadable: 500,
    "extension-build-failed": 500,
    internal: 500,
  };
  for (const [code, status] of Object.entries(expected)) {
    expect(httpStatus(code as EditorErrorCode)).toBe(status);
  }
});
