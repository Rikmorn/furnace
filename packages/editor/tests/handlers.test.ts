import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers, dispatch } from "../src/daemon/handlers.ts";

function projectFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "furnace-handlers-test-"));
  mkdirSync(join(root, "scenes"), { recursive: true });
  writeFileSync(
    join(root, "scenes", "a.scene.json"),
    JSON.stringify({ version: 1, entities: [] }),
  );
  return root;
}

test("scene.list returns the project's scene paths", async () => {
  const handlers = createHandlers({
    root: projectFixture(),
    scenesPattern: "**/*.scene.json",
  });
  expect(await dispatch(handlers, "scene.list", {})).toEqual({
    scenes: ["scenes/a.scene.json"],
  });
});

test("scene.read returns the parsed document", async () => {
  const handlers = createHandlers({
    root: projectFixture(),
    scenesPattern: "**/*.scene.json",
  });
  const result = await dispatch(handlers, "scene.read", {
    path: "scenes/a.scene.json",
  });
  expect(result).toEqual({ document: { version: 1, entities: [] } });
});

test("unknown command throws a NotFound-coded error", async () => {
  const handlers = createHandlers({
    root: projectFixture(),
    scenesPattern: "**/*.scene.json",
  });
  await expect(dispatch(handlers, "scene.zap", {})).rejects.toMatchObject({
    code: 404,
  });
});

test("invalid input throws a BadRequest-coded error naming the field", async () => {
  const handlers = createHandlers({
    root: projectFixture(),
    scenesPattern: "**/*.scene.json",
  });
  await expect(
    dispatch(handlers, "scene.read", { path: 7 }),
  ).rejects.toMatchObject({ code: 400 });
});

test("handler domain errors carry 404 (missing scene)", async () => {
  const handlers = createHandlers({
    root: projectFixture(),
    scenesPattern: "**/*.scene.json",
  });
  await expect(
    dispatch(handlers, "scene.read", { path: "ghost.scene.json" }),
  ).rejects.toMatchObject({
    code: 404,
  });
});
