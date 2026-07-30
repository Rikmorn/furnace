// Pure store tests — no DOM (safe in bare tests/): a Map-backed fake Storage exercises
// namespacing, per-project isolation, versioning, corruption tolerance, and quota safety.
//
// UiState carries exactly ONE key today (`layout`), so every case below drives that key.
// The "keys are independent" case the scene era had went with `lastScene`/`recentScenes`;
// it comes back the moment a second key does.
import { expect, test } from "bun:test";
import { createUiStore } from "../src/frontend/lib/persist.ts";

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
  const layout = { grid: { root: "field" } };
  store.set("layout", layout);
  // A fresh store over the same storage + root reads the persisted value.
  expect(createUiStore(fake, "/proj/root").get("layout")).toEqual(layout);
  // A different project root is isolated (per-project namespacing).
  expect(createUiStore(fake, "/other").get("layout")).toBeUndefined();
  // Corrupt the blob → the store reads it as empty rather than throwing.
  backing.set([...backing.keys()][0] ?? "", "{not json");
  expect(createUiStore(fake, "/proj/root").get("layout")).toBeUndefined();
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
});

test("a setItem failure (quota) is swallowed, never thrown", () => {
  const throwing = {
    getItem: () => "{}",
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  } as unknown as Storage;
  const store = createUiStore(throwing, "/p");
  expect(() => store.set("layout", { a: 1 })).not.toThrow();
});
