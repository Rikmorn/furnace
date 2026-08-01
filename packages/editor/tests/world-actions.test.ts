// The world verbs, driven without a DOM: `world-actions.ts` takes its api and its host
// as arguments precisely so this file can be a bare `bun:test` (the notify-store
// precedent — the seams a module cannot be tested through are the ones it should be
// handed).
//
// What is pinned here is everything the UI must NOT be able to get wrong: the name
// gate, the tracked-overwrite guard, and the two-call bake ordering that was lifted out
// of the field toolbar. The badge/confirm chrome around them lives in
// tests/chrome/world-drawer.test.tsx.
import { afterEach, expect, test } from "bun:test";
import type { WorldRow } from "../src/frontend/lib/api.ts";
import { notify } from "../src/frontend/lib/notify-store.ts";
import type { UiState, UiStore } from "../src/frontend/lib/persist.ts";
import {
  loadWorldInto,
  rememberWorld,
  saveWorld,
  type WorldApi,
  type WorldHost,
  worldToRestore,
} from "../src/frontend/lib/world-actions.ts";

// The store is a module singleton (one editor, one log), so a message raised by one
// case is still there for the next. Clearing also cancels the TTL timers.
afterEach(() => notify.clear());

// --- doubles -----------------------------------------------------------------

type BakeCall = { paths: string[]; cleanDir: string | undefined };

/** A recording `WorldApi`. `rows` is what `world.list` reports — the tracked flag the
 *  overwrite guard reads comes from here, exactly as it does from the daemon. */
function stubApi(
  opts: { rows?: WorldRow[]; bakeFiles?: number; listThrows?: Error } = {},
) {
  const bakes: BakeCall[] = [];
  const api: WorldApi = {
    worldList: () => {
      if (opts.listThrows) return Promise.reject(opts.listThrows);
      return Promise.resolve({
        defaultName: opts.rows?.find((w) => w.isDefault)?.name ?? null,
        worlds: opts.rows ?? [],
      });
    },
    generationBake: (files, cleanDir) => {
      bakes.push({ paths: files.map((f) => f.path), cleanDir });
      return Promise.resolve({ files: opts.bakeFiles ?? files.length });
    },
    fieldLoad: () =>
      Promise.resolve({
        manifest: { version: 2, cellSize: 0.25 },
        // One chunk, base64 of the three bytes [1,2,3].
        chunks: [{ key: "0,0,0", data: "AQID" }],
        materials: [{ key: "0,0,0", data: "BAUG" }],
        oplog: '{"ops":[]}',
      }),
  };
  return { api, bakes };
}

/** A recording `WorldHost`: `exportArtifact` returns a fixed two-file artifact so the
 *  wire marshalling and the call ordering are both assertable. */
function stubHost() {
  const loads: Parameters<WorldHost["loadWorld"]>[0][] = [];
  const host: WorldHost = {
    exportArtifact: (name) => [
      { path: `worlds/${name}/manifest.json`, contents: '{"version":2}' },
      {
        path: `worlds/${name}/0,0,0.fmesh`,
        contents: new Uint8Array([1, 2, 3]),
      },
    ],
    loadWorld: (data) => void loads.push(data),
  };
  return { host, loads };
}

const row = (over: Partial<WorldRow> = {}): WorldRow => ({
  name: "cavern",
  kind: "field",
  isDefault: false,
  tracked: null,
  manifestMtimeMs: 0,
  ...over,
});

const lastText = (): string | undefined => notify.getSnapshot().log[0]?.text;

// --- the name gate -----------------------------------------------------------

test("save refuses an invalid world name before it can burn a bake", async () => {
  const { api, bakes } = stubApi();
  const { host } = stubHost();
  for (const name of ["", "../etc", "a b", "-leading"]) {
    const outcome = await saveWorld(
      { api, host },
      { name, makeDefault: false },
    );
    expect(outcome).toEqual({ status: "invalid-name" });
  }
  // Nothing reached the daemon — not even the list. A refusal that still round-trips
  // is a refusal that can fail for a second reason.
  expect(bakes).toEqual([]);
});

test("load refuses an invalid world name", async () => {
  const { api } = stubApi();
  const { host, loads } = stubHost();
  expect(await loadWorldInto({ api, host }, { name: "../x" })).toEqual({
    status: "invalid-name",
  });
  expect(loads).toEqual([]);
});

// --- the tracked-overwrite guard (D-21) --------------------------------------

test("saving over a TRACKED world refuses until the caller confirms", async () => {
  const { api, bakes } = stubApi({ rows: [row({ tracked: true })] });
  const { host } = stubHost();

  const first = await saveWorld(
    { api, host },
    { name: "cavern", makeDefault: false },
  );
  // Not an error and not a toast: the caller has to ROUTE this into a confirm that
  // names the files, which is the whole point of a distinct outcome.
  expect(first).toEqual({ status: "needs-tracked-confirm" });
  expect(bakes).toEqual([]);
  expect(notify.getSnapshot().log).toEqual([]);

  const second = await saveWorld(
    { api, host },
    { name: "cavern", makeDefault: false, confirmedTracked: true },
  );
  expect(second.status).toBe("saved");
  expect(bakes.length).toBe(1);
});

test("an UNtracked world saves straight through; an indeterminate one degrades to no warning", async () => {
  for (const tracked of [false, null] as const) {
    const { api, bakes } = stubApi({ rows: [row({ tracked })] });
    const { host } = stubHost();
    const outcome = await saveWorld(
      { api, host },
      { name: "cavern", makeDefault: false },
    );
    expect(outcome.status).toBe("saved");
    expect(bakes.length).toBe(1);
  }
});

test("a world that does not exist yet has nothing to overwrite", async () => {
  // Save-as onto a fresh name: no row, so no tracked flag, so no guard. Without this
  // the FIRST save of every new world would raise a warning about a file set that
  // isn't there.
  const { api, bakes } = stubApi({
    rows: [row({ name: "other", tracked: true })],
  });
  const { host } = stubHost();
  const outcome = await saveWorld(
    { api, host },
    { name: "cavern", makeDefault: false },
  );
  expect(outcome.status).toBe("saved");
  expect(bakes.length).toBe(1);
});

test("a world.list failure fails the save rather than silently dropping the guard", async () => {
  const { api, bakes } = stubApi({ listThrows: new Error("daemon is gone") });
  const { host } = stubHost();
  const outcome = await saveWorld(
    { api, host },
    { name: "cavern", makeDefault: false },
  );
  // Degrading to "indeterminate → no warning" here would turn a daemon hiccup into a
  // silent bypass of the one guard standing between a scratch session and the
  // committed world.
  expect(outcome).toEqual({ status: "failed", message: "daemon is gone" });
  expect(bakes).toEqual([]);
  // The pre-check's OWN message: it names the check that refused and promises what only
  // a pre-write failure can promise — that nothing was written. The write-path catch
  // cannot say that (it may have cleanDir'd a directory and half-filled it), so
  // conflating the two would tell the user to go inspect a directory that is untouched.
  expect(lastText()).toBe(
    "save refused — could not check whether worlds/cavern is tracked (daemon is gone); nothing was written",
  );
});

test("a mid-upload failure says only that it FAILED — it cannot promise the disk is clean", async () => {
  const { api } = stubApi({ rows: [row()] });
  const { host } = stubHost();
  // The world files land; worlds/index.json does not. Nothing here may claim "nothing
  // was written" — the world directory has already been cleanDir'd and rewritten.
  let call = 0;
  const outcome = await saveWorld(
    {
      api: {
        ...api,
        generationBake: (files) => {
          call += 1;
          return call === 1
            ? Promise.resolve({ files: files.length })
            : Promise.reject(new Error("ENOSPC"));
        },
      },
      host,
    },
    { name: "cavern", makeDefault: true },
  );
  expect(outcome).toEqual({ status: "failed", message: "ENOSPC" });
  expect(lastText()).toBe("bake failed: ENOSPC");
  expect(lastText()).not.toContain("nothing was written");
});

// --- the upload sequence (lifted from the toolbar, unchanged) ----------------

test("a plain save is ONE cleanDir'd call over the world's own directory", async () => {
  const { api, bakes } = stubApi({ bakeFiles: 12 });
  const { host } = stubHost();
  const outcome = await saveWorld(
    { api, host },
    { name: "cavern", makeDefault: false },
  );
  expect(outcome).toEqual({ status: "saved", files: 12 });
  expect(bakes).toEqual([
    {
      paths: ["worlds/cavern/manifest.json", "worlds/cavern/0,0,0.fmesh"],
      cleanDir: "worlds/cavern",
    },
  ]);
  expect(lastText()).toBe("saved 12 files → worlds/cavern");
});

test("bake-as-default keeps the two-call ORDER: world files, then worlds/index.json", async () => {
  const { api, bakes } = stubApi({ bakeFiles: 12 });
  const { host } = stubHost();
  const outcome = await saveWorld(
    { api, host },
    { name: "cavern", makeDefault: true },
  );
  expect(outcome).toEqual({ status: "saved", files: 12 });
  // index.json is written SECOND and with NO cleanDir (it lives outside the world
  // dir): the index must never name a world that isn't on disk yet, and cleaning
  // against worlds/cavern would reject a path outside it.
  expect(bakes.length).toBe(2);
  expect(bakes[0]?.cleanDir).toBe("worlds/cavern");
  expect(bakes[1]).toEqual({
    paths: ["worlds/index.json"],
    cleanDir: undefined,
  });
  expect(lastText()).toBe("baked 12 files — now the game's world");
});

test("the binary sidecar is base64'd for the JSON POST; text passes through", async () => {
  const { api } = stubApi();
  const { host } = stubHost();
  const wire: { path: string; encoding: string; contents: string }[] = [];
  await saveWorld(
    {
      api: {
        ...api,
        generationBake: (files) => {
          wire.push(...files);
          return Promise.resolve({ files: files.length });
        },
      },
      host,
    },
    { name: "cavern", makeDefault: false },
  );
  expect(wire[0]).toMatchObject({
    encoding: "utf8",
    contents: '{"version":2}',
  });
  expect(wire[1]?.encoding).toBe("base64");
  expect([...Buffer.from(wire[1]?.contents ?? "", "base64")]).toEqual([
    1, 2, 3,
  ]);
});

// --- load --------------------------------------------------------------------

test("load decodes both sibling kinds and hands the raw oplog to the host", async () => {
  const { api } = stubApi();
  const { host, loads } = stubHost();
  const outcome = await loadWorldInto({ api, host }, { name: "cavern" });
  expect(outcome).toEqual({ status: "loaded", chunks: 1 });
  const data = loads[0];
  expect([...(data?.chunks[0]?.bytes ?? [])]).toEqual([1, 2, 3]);
  expect([...(data?.materials?.[0]?.bytes ?? [])]).toEqual([4, 5, 6]);
  // Raw TEXT, not parsed: only the host can call field.parseOps (the chrome's core
  // imports are type-only), and it is what maps legacy F1 ops forward.
  expect(data?.oplog).toBe('{"ops":[]}');
  expect(lastText()).toBe("loaded cavern (1 chunks)");
});

test("a load failure reports and leaves the host untouched", async () => {
  const { api } = stubApi();
  const { host, loads } = stubHost();
  const outcome = await loadWorldInto(
    {
      api: {
        ...api,
        fieldLoad: () => Promise.reject(new Error("no such world")),
      },
      host,
    },
    { name: "cavern" },
  );
  expect(outcome).toEqual({ status: "failed", message: "no such world" });
  expect(loads).toEqual([]);
  expect(lastText()).toBe("load failed: no such world");
});

// --- lastWorld: the world the next boot reopens -------------------------------
//
// The WRITE half and the read half's DECISION. What the chrome does with that decision
// — the one-shot, the pristine-session gate, the in-flight readout — is behaviour with a
// provider behind it, and lives in tests/chrome/world-boot-restore.test.tsx.

function fakeStore(initial: UiState = {}): UiStore {
  const data: UiState = { ...initial };
  return {
    get: (key) => data[key],
    set: (key, value) => {
      // Mirrors the real store: an undefined value REMOVES the key.
      if (value === undefined) delete data[key];
      else Object.assign(data, { [key]: value });
    },
  };
}

test("remembering a world writes lastWorld", () => {
  const store = fakeStore();
  rememberWorld(store, "cavern");
  expect(store.get("lastWorld")).toBe("cavern");
  rememberWorld(store, "grotto");
  expect(store.get("lastWorld")).toBe("grotto");
});

test("remembering with no store is a no-op, not a crash", () => {
  // Persistence is best-effort: the store is undefined until `project.get` resolves,
  // and forever if it fails. A save must still work then.
  expect(() => rememberWorld(undefined, "cavern")).not.toThrow();
});

test("the boot restore names the persisted world when the daemon still lists it", async () => {
  const { api } = stubApi({
    rows: [row({ name: "cavern" }), row({ name: "grotto" })],
  });
  expect(
    await worldToRestore({ api }, fakeStore({ lastWorld: "grotto" })),
  ).toBe("grotto");
});

test("the boot restore names nothing when there is nothing to reopen", async () => {
  const { api } = stubApi({ rows: [row({ name: "cavern" })] });
  let lists = 0;
  const counting = {
    worldList: () => {
      lists++;
      return api.worldList();
    },
  };

  // A first-ever boot, and a project whose `project.get` never resolved. Both mean "stay
  // on the untitled scratch" — and neither costs a round trip to find that out.
  expect(await worldToRestore({ api: counting }, fakeStore())).toBeNull();
  expect(await worldToRestore({ api: counting }, undefined)).toBeNull();
  expect(lists).toBe(0);
});

test("the boot restore refuses a world that is gone, legacy, or unreachable", async () => {
  const { api } = stubApi({
    rows: [row({ name: "cavern" }), row({ name: "old-cave", kind: "legacy" })],
  });
  // Deleted, renamed, or gone with a branch switch between sessions.
  expect(
    await worldToRestore({ api }, fakeStore({ lastWorld: "grotto" })),
  ).toBeNull();
  // v1: `field.load` only speaks v2, so opening one would fail somewhere in the daemon —
  // an error toast at boot for a world nobody asked to open. The drawer disables its Open
  // button on the same fact.
  expect(
    await worldToRestore({ api }, fakeStore({ lastWorld: "old-cave" })),
  ).toBeNull();
  // The daemon went away mid-boot. Same answer, and the same silence: an unrequested
  // open that cannot happen has nothing to say.
  const failing = stubApi({ listThrows: new Error("daemon gone") });
  expect(
    await worldToRestore(
      { api: failing.api },
      fakeStore({ lastWorld: "cavern" }),
    ),
  ).toBeNull();
});
