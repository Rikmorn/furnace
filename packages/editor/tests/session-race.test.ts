import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  RegistryLoader,
  RegistryModule,
} from "../src/daemon/registry-bundle.ts";
import {
  createSession,
  type SessionEvent,
  serialize,
} from "../src/daemon/session.ts";

// biome-ignore lint/suspicious/noEmptyBlockStatements: no-op stubs (unwatch / invalidate)
const noop = (): void => {};

// A permissive registry — these tests exercise the state-swap interleaving, not
// validation. The gating (which await the swap lands inside) is done per-test.
const fakeRegistry: RegistryModule = {
  validateDocument: noop,
  introspect: () => ({}),
  CURRENT_SCENE_VERSION: 1,
};

/** A promise the test resolves by hand — the interleaving lever. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Two scene files under an in-fixtures temp root (never os.tmpdir — mirrors
 *  handlers.test.ts). The stub registry means esbuild never runs, so no
 *  workspace @furnace/core resolution is needed. */
function fixtureDir(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-race-"));
  writeFileSync(
    join(root, "a.scene.json"),
    `${JSON.stringify({ version: 1, entities: [{ id: "cube", components: {} }] }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "b.scene.json"),
    `${JSON.stringify({ version: 1, entities: [{ id: "sphere", components: {} }] }, null, 2)}\n`,
  );
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const documentChanged = (events: readonly SessionEvent[]): SessionEvent[] =>
  events.filter((e) => e.type === "document-changed");

test("apply race: an open() during a pending apply() rejects no-session, never commits the stale doc", async () => {
  const { root, cleanup } = fixtureDir();
  try {
    // apply()'s only await is registry.current(); open() uses reload(). Gating
    // current() lands the swap precisely inside apply()'s validation await.
    const gate = deferred<RegistryModule>();
    const registry: RegistryLoader = {
      reload: () => Promise.resolve(fakeRegistry),
      current: () => gate.promise,
      invalidate: noop,
    };
    const events: SessionEvent[] = [];
    const session = createSession({
      root,
      watchFile: () => noop,
      registry,
      emit: (e) => events.push(e),
    });

    await session.open("a.scene.json", false); // state = A, revision 0
    const applyPromise = session.apply("scene.addEntity", (doc) => {
      doc.entities.push({ id: "x", components: {} });
    });
    // apply() is now suspended at `await registry.current()`. Swap the session.
    await session.open("b.scene.json", true); // state = B
    gate.resolve(fakeRegistry); // apply() resumes → staleness guard fires

    await expect(applyPromise).rejects.toMatchObject({ code: "no-session" });
    // The stale commit + its document-changed emission were both blocked.
    expect(documentChanged(events)).toHaveLength(0);
  } finally {
    cleanup();
  }
});

test("onFileChanged race: an open() during a pending file-reload silently drops the stale reload", async () => {
  const { root, cleanup } = fixtureDir();
  try {
    const readGate = deferred<string>();
    let captured: (() => Promise<void>) | undefined;
    const registry: RegistryLoader = {
      reload: () => Promise.resolve(fakeRegistry),
      current: () => Promise.resolve(fakeRegistry),
      invalidate: noop,
    };
    const events: SessionEvent[] = [];
    const session = createSession({
      root,
      watchFile: (_path, onChange) => {
        captured = onChange;
        return noop;
      },
      registry,
      emit: (e) => events.push(e),
      // onFileChanged's readFile await is gated; the swap lands inside it.
      readTextFile: () => readGate.promise,
    });

    await session.open("a.scene.json", false); // captures onFileChanged; state = A
    if (!captured) throw new Error("watchFile never captured the callback");
    const reloadPromise = captured(); // suspends at the gated read
    await session.open("b.scene.json", true); // state = B
    // Valid content that differs from A's saved text — WOULD emit
    // document-changed if the stale callback weren't guarded.
    readGate.resolve(
      serialize({ version: 1, entities: [{ id: "reloaded", components: {} }] }),
    );
    await reloadPromise;

    // File-reload events are notification-only dirty-bits: a stale one is
    // silently dropped, not surfaced.
    expect(documentChanged(events)).toHaveLength(0);
  } finally {
    cleanup();
  }
});
