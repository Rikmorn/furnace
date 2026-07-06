// packages/editor/tests/handlers.test.ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DaemonEvent } from "../src/daemon/events.ts";
import {
  createHandlers,
  dispatch,
  type Handlers,
} from "../src/daemon/handlers.ts";
import { createRegistryLoader } from "../src/daemon/registry-bundle.ts";
import { createSession, type Session } from "../src/daemon/session.ts";

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op stub — file-change semantics are session.test.ts's job
const noopUnwatch = (): void => {};

// Real session + real registry over an IN-WORKSPACE copy of mini-project
// (esbuild resolves @furnace/core through the workspace node_modules; an
// os.tmpdir() copy could not — same constraint as server.test.ts documents).
const MINI = join(import.meta.dir, "fixtures", "mini-project");
let root: string;
let session: Session;
let handlers: Handlers;
const events: DaemonEvent[] = [];

beforeAll(() => {
  root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-m4-"));
  cpSync(MINI, root, { recursive: true });
  session = createSession({
    root,
    watchFile: () => noopUnwatch, // file-change semantics are session.test.ts's job
    registry: createRegistryLoader(root, "src/editor-extensions.ts"),
    emit: (e) => events.push(e),
  });
  handlers = createHandlers({
    root,
    scenesPattern: "**/*.scene.json",
    session,
    emit: (e) => events.push(e),
  });
});
afterAll(() => {
  session.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("scene.list and scene.read still work", async () => {
  expect(await dispatch(handlers, "scene.list", {})).toEqual({
    scenes: ["scenes/cube.scene.json"],
  });
  const read = (await dispatch(handlers, "scene.read", {
    path: "scenes/cube.scene.json",
  })) as { document: { version: number } };
  expect(read.document.version).toBe(1);
});

test("unknown command / bad envelope / no-session carry codes", async () => {
  await expect(dispatch(handlers, "scene.zap", {})).rejects.toMatchObject({
    code: "unknown-command",
  });
  await expect(
    dispatch(handlers, "scene.read", { path: 7 }),
  ).rejects.toMatchObject({ code: "invalid-input" });
  await expect(dispatch(handlers, "scene.get", {})).rejects.toMatchObject({
    code: "no-session",
  });
});

test("the full mutation flow: open → introspect → mutate → undo → save", async () => {
  const opened = (await dispatch(handlers, "scene.open", {
    path: "scenes/cube.scene.json",
  })) as { revision: number; dirty: boolean; document: unknown };
  expect(opened.revision).toBe(0);
  expect(opened.dirty).toBe(false);

  const reflection = await dispatch(handlers, "scene.introspect", {});
  expect(JSON.stringify(reflection)).toContain("fixtureGlow");

  const added = (await dispatch(handlers, "scene.addEntity", {})) as {
    id: string;
    revision: number;
  };
  expect(added.id).toBe("entity-1");
  expect(added.revision).toBe(1);

  await dispatch(handlers, "scene.setComponent", {
    entity: "entity-1",
    component: "fixtureGlow",
    params: { intensity: 3 },
  });

  // Registry rejects bad params — transactional, with the registry's message.
  await expect(
    dispatch(handlers, "scene.setComponent", {
      entity: "entity-1",
      component: "fixtureGlow",
      params: { intensity: "loud" },
    }),
  ).rejects.toMatchObject({ code: "validation-failed" });

  // Referenced resource cannot be removed (cube's meshRenderer uses "g").
  await expect(
    dispatch(handlers, "scene.removeResource", {
      table: "geometries",
      id: "g",
    }),
  ).rejects.toMatchObject({ code: "validation-failed" });

  const undone = (await dispatch(handlers, "scene.undo", {})) as {
    revision: number;
  };
  expect(undone.revision).toBe(3);

  await dispatch(handlers, "scene.save", {});
  const onDisk = JSON.parse(
    readFileSync(join(root, "scenes", "cube.scene.json"), "utf8"),
  ) as { entities: { id: string }[] };
  expect(onDisk.entities.map((e) => e.id)).toContain("entity-1");
});

test("scene.validate: file path and inline document; exactly one required", async () => {
  expect(
    await dispatch(handlers, "scene.validate", {
      path: "scenes/cube.scene.json",
    }),
  ).toEqual({ valid: true });
  const bad = (await dispatch(handlers, "scene.validate", {
    document: {
      version: 1,
      entities: [{ id: "e", components: { fixtureGlow: { intensity: "x" } } }],
    },
  })) as { valid: boolean; message?: string };
  expect(bad.valid).toBe(false);
  expect(bad.message).toContain("fixtureGlow");
  await expect(dispatch(handlers, "scene.validate", {})).rejects.toMatchObject({
    code: "invalid-input",
  });
});

test("scene.batch applies all edits in one snapshot (one undo reverts all)", async () => {
  await dispatch(handlers, "scene.open", {
    path: "scenes/cube.scene.json",
    force: true,
  });
  await dispatch(handlers, "scene.addEntity", {
    id: "ba",
    components: { transform: { position: [0, 0, 0] } },
  });
  await dispatch(handlers, "scene.addEntity", {
    id: "bb",
    components: { transform: { position: [0, 0, 0] } },
  });
  const before = (await dispatch(handlers, "scene.get", {})) as {
    document: {
      entities: { id: string; components: Record<string, unknown> }[];
    };
    revision: number;
  };
  const r = (await dispatch(handlers, "scene.batch", {
    edits: [
      { entity: "ba", component: "transform", params: { position: [1, 0, 0] } },
      { entity: "bb", component: "transform", params: { position: [2, 0, 0] } },
    ],
  })) as { revision: number; dirty: boolean };
  expect(r.revision).toBe(before.revision + 1); // ONE revision bump for two edits

  await dispatch(handlers, "scene.undo", {});
  const after = (await dispatch(handlers, "scene.get", {})) as {
    document: {
      entities: { id: string; components: Record<string, unknown> }[];
    };
  };
  expect(after.document.entities).toEqual(before.document.entities); // one undo reverts BOTH
});

test("scene.batch rejects the whole batch if any edit is invalid (session untouched)", async () => {
  await dispatch(handlers, "scene.open", {
    path: "scenes/cube.scene.json",
    force: true,
  });
  await dispatch(handlers, "scene.addEntity", {
    id: "rb",
    components: { transform: { position: [0, 0, 0] } },
  });
  const before = (await dispatch(handlers, "scene.get", {})) as {
    revision: number;
  };
  await expect(
    dispatch(handlers, "scene.batch", {
      edits: [
        {
          entity: "rb",
          component: "transform",
          params: { position: [9, 0, 0] },
        },
        {
          entity: "ghost",
          component: "transform",
          params: { position: [0, 0, 0] },
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "validation-failed" });
  const after = (await dispatch(handlers, "scene.get", {})) as {
    revision: number;
  };
  expect(after.revision).toBe(before.revision); // no partial apply
});
