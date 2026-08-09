import { expect, test } from "bun:test";
import {
  EditorError,
  type EditorErrorCode,
  httpStatus,
} from "../src/daemon/errors.ts";

test("EditorError carries a string code and message", () => {
  const err = new EditorError("not-found", 'world "x" does not exist');
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("EditorError");
  expect(err.code).toBe("not-found");
  expect(err.message).toContain("does not exist");
});

test("httpStatus maps every code to its spec'd status", () => {
  const expected: Record<EditorErrorCode, number> = {
    "invalid-input": 400,
    "invalid-json": 400,
    "unknown-command": 404,
    "not-found": 404,
    "outside-root": 404,
    "already-exists": 409,
    "forbidden-origin": 403,
    internal: 500,
  };
  for (const [code, status] of Object.entries(expected)) {
    expect(httpStatus(code as EditorErrorCode)).toBe(status);
  }
});
