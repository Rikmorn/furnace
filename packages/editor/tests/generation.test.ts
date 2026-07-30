import { expect, test } from "bun:test";
import {
  bakeUploadCalls,
  isValidWorldName,
  toWireFiles,
  type WireFile,
} from "../src/frontend/lib/generation.ts";

test("toWireFiles: utf8 passes through, binary base64 round-trips exactly", () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 254, 255, 128, 42]);
  const wire = toWireFiles([
    { path: "worlds/default/world.scene.json", contents: '{"version":1}' },
    { path: "worlds/default/cave-a.fmesh", contents: bytes },
  ]);

  expect(wire[0]).toEqual({
    path: "worlds/default/world.scene.json",
    encoding: "utf8",
    contents: '{"version":1}',
  });

  const binary = wire[1];
  expect(binary?.encoding).toBe("base64");
  expect(binary?.path).toBe("worlds/default/cave-a.fmesh");
  // Decode the base64 back to the exact bytes (the daemon does the same).
  const decoded = new Uint8Array(Buffer.from(binary?.contents ?? "", "base64"));
  expect([...decoded]).toEqual([...bytes]);
});

test("toWireFiles: base64 survives a > one-chunk buffer (no fromCharCode overflow)", () => {
  const big = new Uint8Array(0x8000 * 2 + 7).map((_, i) => i % 256);
  const wire = toWireFiles([
    { path: "worlds/default/big.fmesh", contents: big },
  ]);
  const decoded = new Uint8Array(
    Buffer.from(wire[0]?.contents ?? "", "base64"),
  );
  expect(decoded.length).toBe(big.length);
  expect([...decoded]).toEqual([...big]);
});

test("isValidWorldName", () => {
  expect(isValidWorldName("default")).toBe(true);
  expect(isValidWorldName("My_World2")).toBe(true);
  expect(isValidWorldName("")).toBe(false);
  expect(isValidWorldName("../x")).toBe(false);
  expect(isValidWorldName("a b")).toBe(false);
});

test("bakeUploadCalls: world files cleanDir'd; index.json rides a second cleanDir-FREE call", () => {
  const files: WireFile[] = [
    { path: "worlds/w1/manifest.json", encoding: "utf8", contents: "{}" },
  ];
  const calls = bakeUploadCalls(files, "worlds/w1", "w1", true);
  expect(calls.length).toBe(2);
  expect(calls[0]).toEqual({ files, cleanDir: "worlds/w1" });
  expect(calls[1]?.cleanDir).toBeUndefined(); // outside the world dir — MUST NOT clean
  expect(calls[1]?.files[0]?.path).toBe("worlds/index.json");
  expect(JSON.parse(calls[1]?.files[0]?.contents ?? "")).toEqual({
    version: 1,
    default: "w1",
  });
});

test("bakeUploadCalls: the index write is byte-identical to the committed worlds/index.json shape", () => {
  const [, indexCall] = bakeUploadCalls([], "worlds/default", "default", true);
  // 2-space JSON + a trailing newline — re-defaulting "default" must be a no-op diff
  // against the committed packages/dungeon/worlds/index.json.
  expect(indexCall?.files[0]?.contents).toBe(
    '{\n  "version": 1,\n  "default": "default"\n}\n',
  );
});

test("bakeUploadCalls: makeDefault off -> exactly one call, no index write", () => {
  const files: WireFile[] = [
    { path: "worlds/w1/manifest.json", encoding: "utf8", contents: "{}" },
  ];
  expect(bakeUploadCalls(files, "worlds/w1", "w1", false)).toEqual([
    { files, cleanDir: "worlds/w1" },
  ]);
});
