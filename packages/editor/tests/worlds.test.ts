// packages/editor/tests/worlds.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonEvent } from "../src/daemon/events.ts";
import {
  createHandlers,
  dispatch,
  type Handlers,
} from "../src/daemon/handlers.ts";
import { createRegistryLoader } from "../src/daemon/registry-bundle.ts";
import { createSession, type Session } from "../src/daemon/session.ts";
import type { WorldRow } from "../src/daemon/worlds.ts";

// Real session + real registry over an IN-WORKSPACE copy of mini-project (esbuild
// resolves @furnace/core through the workspace node_modules; an os.tmpdir() copy
// could not — the same constraint field-load.test.ts documents).
const MINI = join(import.meta.dir, "fixtures", "mini-project");

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op stub — file-change semantics are session.test.ts's job
const noopUnwatch = (): void => {};

let root: string;
let session: Session;
let events: DaemonEvent[];

beforeEach(() => {
  root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-worlds-"));
  cpSync(MINI, root, { recursive: true });
  events = [];
  session = createSession({
    root,
    watchFile: () => noopUnwatch, // file-change semantics are session.test.ts's job
    registry: createRegistryLoader(root, "src/editor-extensions.ts"),
    emit: (e) => events.push(e),
  });
});

afterEach(() => {
  session.dispose();
  rmSync(root, { recursive: true, force: true });
});

/** Build a handlers map over the shared session, optionally injecting the
 *  tracked-checker capability under test (mirrors production's isTracked wiring). */
function build(isTracked?: (rel: string) => boolean): Handlers {
  return createHandlers({
    root,
    scenesPattern: "**/*.scene.json",
    session,
    emit: (e) => events.push(e),
    isTracked,
  });
}

type ListResult = { defaultName: string | null; worlds: WorldRow[] };

describe("world.list", () => {
  test("enumerates worlds with kind, default flag, and mtime", async () => {
    mkdirSync(join(root, "worlds"), { recursive: true });
    writeFileSync(
      join(root, "worlds", "index.json"),
      JSON.stringify({ version: 1, default: "default" }),
    );

    // Legacy world: scene-backed, no oplog.json (matches packages/dungeon/worlds/default).
    const defaultDir = join(root, "worlds", "default");
    mkdirSync(defaultDir, { recursive: true });
    writeFileSync(
      join(defaultDir, "world.scene.json"),
      JSON.stringify({ entities: [] }),
    );
    writeFileSync(
      join(defaultDir, "manifest.json"),
      JSON.stringify({ version: 1, scene: "worlds/default/world.scene.json" }),
    );

    // Field world: oplog-backed, v2 manifest with a chunks array.
    const scratchDir = join(root, "worlds", "scratch-a");
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, "oplog.json"), JSON.stringify([]));
    writeFileSync(
      join(scratchDir, "manifest.json"),
      JSON.stringify({
        version: 2,
        kind: "field",
        cellSize: 0.25,
        chunks: [{ key: "0,0,0", file: "chunks/0_0_0.bin" }],
      }),
    );

    // Not a world: no manifest.json at all — must be excluded (crash-safety:
    // manifest-last means a dir without one is a partial/in-progress write).
    mkdirSync(join(root, "worlds", "not-a-world"), { recursive: true });

    const handlers = build();
    const res = (await dispatch(handlers, "world.list", {})) as ListResult;

    expect(res.defaultName).toBe("default");
    const names = res.worlds.map((w) => w.name).sort();
    expect(names).toEqual(["default", "scratch-a"]);

    const def = res.worlds.find((w) => w.name === "default");
    expect(def?.kind).toBe("legacy");
    expect(def?.isDefault).toBe(true);

    const scratch = res.worlds.find((w) => w.name === "scratch-a");
    expect(scratch?.kind).toBe("field");
    expect(scratch?.isDefault).toBe(false);
    expect(typeof scratch?.manifestMtimeMs).toBe("number");
  });

  test("reports tracked via the injected checker; null checker => tracked null", async () => {
    for (const name of ["default", "scratch-a"]) {
      const dir = join(root, "worlds", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ version: 1 }));
    }

    const tracked = build((rel) => rel.endsWith("default"));
    const trackedRes = (await dispatch(
      tracked,
      "world.list",
      {},
    )) as ListResult;
    const trackedDefault = trackedRes.worlds.find((w) => w.name === "default");
    const trackedScratch = trackedRes.worlds.find(
      (w) => w.name === "scratch-a",
    );
    expect(trackedDefault?.tracked).toBe(true);
    expect(trackedScratch?.tracked).toBe(false);

    const untracked = build();
    const untrackedRes = (await dispatch(
      untracked,
      "world.list",
      {},
    )) as ListResult;
    expect(untrackedRes.worlds.every((w) => w.tracked === null)).toBe(true);
  });

  test("with no worlds dir returns empty list + defaultName null", async () => {
    const handlers = build();
    const res = (await dispatch(handlers, "world.list", {})) as ListResult;
    expect(res).toEqual({ defaultName: null, worlds: [] });
  });
});
