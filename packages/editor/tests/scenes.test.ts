import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listScenes, readScene } from "../src/daemon/scenes.ts";

function projectFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "furnace-scenes-test-"));
  mkdirSync(join(root, "scenes"), { recursive: true });
  mkdirSync(join(root, "node_modules", "junk"), { recursive: true });
  writeFileSync(
    join(root, "scenes", "a.scene.json"),
    JSON.stringify({ version: 1, entities: [] }),
  );
  writeFileSync(
    join(root, "b.scene.json"),
    JSON.stringify({ version: 1, entities: [] }),
  );
  writeFileSync(join(root, "node_modules", "junk", "x.scene.json"), "{}");
  writeFileSync(join(root, "not-a-scene.json"), "{}");
  return root;
}

test("listScenes finds *.scene.json, sorted, excluding node_modules and dist", async () => {
  const root = projectFixture();
  expect(await listScenes(root, "**/*.scene.json")).toEqual([
    "b.scene.json",
    "scenes/a.scene.json",
  ]);
});

test("readScene returns parsed JSON for a project-relative path", async () => {
  const root = projectFixture();
  expect(await readScene(root, "scenes/a.scene.json")).toEqual({
    version: 1,
    entities: [],
  });
});

test("readScene rejects path traversal out of the project root", async () => {
  const root = projectFixture();
  await expect(readScene(root, "../../../etc/passwd")).rejects.toThrow(
    /outside the project root/,
  );
});

test("readScene rejects a missing file with the path named", async () => {
  const root = projectFixture();
  await expect(readScene(root, "scenes/ghost.scene.json")).rejects.toThrow(
    /ghost\.scene\.json.*not found|not found.*ghost\.scene\.json/,
  );
});

test("readScene surfaces non-ENOENT read errors as 'could not be read', not 'not found'", async () => {
  const root = projectFixture();
  // "scenes" is a directory inside the project — passes the traversal guard,
  // but readFile on a directory throws EISDIR (not ENOENT).
  const err = await readScene(root, "scenes").then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("could not be read");
  expect((err as Error).message).not.toContain("not found");
});

test("readScene rejects malformed JSON naming the file", async () => {
  const root = projectFixture();
  writeFileSync(join(root, "bad.scene.json"), "{ nope");
  await expect(readScene(root, "bad.scene.json")).rejects.toThrow(
    /bad\.scene\.json/,
  );
});

test("readScene failures carry EditorError codes", async () => {
  const root = projectFixture();
  writeFileSync(join(root, "bad.scene.json"), "{ nope");
  await expect(readScene(root, "../escape.json")).rejects.toMatchObject({
    code: "outside-root",
  });
  await expect(readScene(root, "ghost.scene.json")).rejects.toMatchObject({
    code: "not-found",
  });
  await expect(readScene(root, "scenes")).rejects.toMatchObject({
    code: "unreadable",
  });
  await expect(readScene(root, "bad.scene.json")).rejects.toMatchObject({
    code: "invalid-json",
  });
});
