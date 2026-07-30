// Pure store tests — no DOM (safe in bare tests/): a Map-backed fake Storage exercises
// namespacing, per-project isolation, versioning, corruption tolerance, and quota safety.
import { expect, test } from "bun:test";
import {
  createUiStore,
  type PaletteState,
} from "../src/frontend/lib/persist.ts";

function fakeStorage(backing = new Map<string, string>()): Storage {
  return {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage;
}

const PALETTE: PaletteState = {
  x: 24,
  y: 80,
  edge: "right",
  collapsed: false,
  open: true,
};

const WORKSPACE = { palettes: { tools: PALETTE }, hidden: false };

test("namespaced, versioned, schema-tolerant", () => {
  const backing = new Map<string, string>();
  const fake = fakeStorage(backing);
  const store = createUiStore(fake, "/proj/root");
  store.set("workspace", WORKSPACE);
  // A fresh store over the same storage + root reads the persisted value.
  expect(createUiStore(fake, "/proj/root").get("workspace")).toEqual(WORKSPACE);
  // A different project root is isolated (per-project namespacing).
  expect(createUiStore(fake, "/other").get("workspace")).toBeUndefined();
  // Corrupt the blob → the store reads it as empty rather than throwing.
  backing.set([...backing.keys()][0] ?? "", "{not json");
  expect(createUiStore(fake, "/proj/root").get("workspace")).toBeUndefined();
});

// The v1→v2 break, stated directly. The namespacing case above proves the MECHANISM
// (two keys never see each other); this pins that the live VERSION is past 1, so a
// blob written by the dock-era editor is orphaned rather than fed to code that
// expects the new shape. A revert to VERSION = 1 fails here and nowhere else.
test("a v1 blob is ignored, not migrated", () => {
  const backing = new Map<string, string>();
  backing.set(
    "furnace-editor:v1:/proj/root",
    JSON.stringify({ layout: { grid: { root: "field" } } }),
  );
  const store = createUiStore(fakeStorage(backing), "/proj/root");
  expect(store.get("workspace")).toBeUndefined();
  expect(store.get("lastWorld")).toBeUndefined();
  // …and writing under v2 leaves the v1 blob exactly where it was (no in-place
  // rewrite, no deletion — it is simply unreachable).
  store.set("lastWorld", "cavern");
  expect(backing.get("furnace-editor:v1:/proj/root")).toContain("layout");
  expect(backing.size).toBe(2);
});

test("the keys are independent — a write to one leaves the others alone", () => {
  const store = createUiStore(fakeStorage(), "/p");
  store.set("lastWorld", "cavern");
  store.set("recentWorlds", ["cavern", "grotto"]);
  store.set("workspace", WORKSPACE);
  expect(store.get("lastWorld")).toBe("cavern");
  expect(store.get("recentWorlds")).toEqual(["cavern", "grotto"]);
  expect(store.get("workspace")).toEqual(WORKSPACE);
});

test("a missing key reads as undefined", () => {
  expect(createUiStore(fakeStorage(), "/p").get("workspace")).toBeUndefined();
});

test("setting a key to undefined drops it from the persisted blob", () => {
  const store = createUiStore(fakeStorage(), "/p");
  store.set("lastWorld", "cavern");
  expect(store.get("lastWorld")).toBe("cavern");
  store.set("lastWorld", undefined);
  expect(store.get("lastWorld")).toBeUndefined();
});

test("a setItem failure (quota) is swallowed, never thrown", () => {
  const throwing = {
    getItem: () => "{}",
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  } as unknown as Storage;
  const store = createUiStore(throwing, "/p");
  expect(() => store.set("lastWorld", "cavern")).not.toThrow();
});
