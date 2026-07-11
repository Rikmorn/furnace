// Pure store tests — no DOM (safe in bare tests/): a Map-backed fake Storage exercises
// namespacing, per-project isolation, versioning, corruption tolerance, and quota safety.
import { expect, test } from "bun:test";
import { createUiStore, pushRecent } from "../src/frontend/lib/persist.ts";

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

test("namespaced, versioned, schema-tolerant", () => {
  const backing = new Map<string, string>();
  const fake = fakeStorage(backing);
  const store = createUiStore(fake, "/proj/root");
  const flags = { grid: false, axes: true, headlamp: true, fog: false };
  store.set("viewFlags", flags);
  // A fresh store over the same storage + root reads the persisted value.
  expect(createUiStore(fake, "/proj/root").get("viewFlags")).toEqual(flags);
  // A different project root is isolated (per-project namespacing).
  expect(createUiStore(fake, "/other").get("viewFlags")).toBeUndefined();
  // Corrupt the blob → the store reads it as empty rather than throwing.
  backing.set([...backing.keys()][0] ?? "", "{not json");
  expect(createUiStore(fake, "/proj/root").get("viewFlags")).toBeUndefined();
});

test("keys are independent — setting one preserves the others", () => {
  const store = createUiStore(fakeStorage(), "/p");
  store.set("lastScene", "scenes/a.scene.json");
  store.set("recentScenes", ["scenes/a.scene.json"]);
  expect(store.get("lastScene")).toBe("scenes/a.scene.json");
  expect(store.get("recentScenes")).toEqual(["scenes/a.scene.json"]);
});

test("a missing key reads as undefined", () => {
  expect(createUiStore(fakeStorage(), "/p").get("layout")).toBeUndefined();
});

test("setting a key to undefined drops it from the persisted blob", () => {
  const store = createUiStore(fakeStorage(), "/p");
  store.set("layout", { some: "layout" });
  expect(store.get("layout")).toEqual({ some: "layout" });
  store.set("layout", undefined);
  expect(store.get("layout")).toBeUndefined();
  // Other keys survive the drop.
  store.set("lastScene", "x");
  store.set("layout", undefined);
  expect(store.get("lastScene")).toBe("x");
});

test("pushRecent: most-recent-first, deduped, capped", () => {
  // Prepends new items.
  expect(pushRecent([], "a", 8)).toEqual(["a"]);
  expect(pushRecent(["a"], "b", 8)).toEqual(["b", "a"]);
  // Re-visiting an item moves it to the front (dedupes — no duplicate).
  expect(pushRecent(["b", "a"], "a", 8)).toEqual(["a", "b"]);
  // Caps at the limit, dropping the oldest.
  expect(pushRecent(["c", "b", "a"], "d", 3)).toEqual(["d", "c", "b"]);
});

test("a setItem failure (quota) is swallowed, never thrown", () => {
  const throwing = {
    getItem: () => "{}",
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  } as unknown as Storage;
  const store = createUiStore(throwing, "/p");
  expect(() => store.set("lastScene", "x")).not.toThrow();
});
