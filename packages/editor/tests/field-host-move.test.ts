// FieldHost's MOVE session (F4.5b Task 5), headless — the half that needs no
// camera: `beginMove` opening a reconfigure session flagged `moving`, its
// refusals, the region riding the SAME nudge seam the arrows drive, and the drop
// landing as ONE splice entry with the entity id intact.
//
// The pointer half (drag threshold, the cursor→lattice mapping, the gizmo, R)
// lives in `field-host-move.gpu.test.ts`: every one of those resolves through
// `cursorRay` → `camera.screenToRay`, and there is no camera until `init` has
// acquired a context.
//
// HERE and not in `tests/field-host/`, which the plan named: that directory
// holds this slice's PURE module tests, and `bun test` walks a directory's own
// files before its subdirectories — `tests/chrome/` registers happy-dom, which
// replaces `globalThis.navigator`/`crypto`. Every headless FieldHost suite is a
// `tests/` root file for that reason.
//
// The world arrives through `loadWorld` (field-host-entity-verbs.test.ts's
// reason): it is the only headless route to a committed entity, and it puts the
// same span + entity ops in the same log a commit would.
import { expect, test } from "bun:test";
import type {
  FieldManifest,
  FieldOp,
  MaterialTable,
} from "@furnace/core/field";
import {
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  encodeMaterialFile,
  generatorById,
  parseOps,
  serializeOps,
} from "@furnace/core/field";
import { createFieldHost } from "../src/field-host/field-host.ts";
import type { FieldWorkerRequest } from "../src/field-host/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/field-host/field-protocol.ts";
import type { StampSession } from "../src/field-host/field-stamp.ts";
import { LATTICE } from "../src/shared/field-brush.ts";

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** The 3-class fixture every stamp needs (a kit class is mandatory) — the
 *  field-host-entity-verbs.test.ts table verbatim. */
const TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
    {
      id: 2,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};

const HALL_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [5, 4, 5] as [number, number, number],
};

/** A cave: the one registry generator with NO `rotation` param, which is what
 *  the R refusal needs. */
const CAVE_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [12, 8, 12] as [number, number, number],
};

type Committed = { id: string; seed: number; region: typeof HALL_REGION };

/** Builds a world with CORE (one commit per entry) and hands it to `host`
 *  through loadWorld. Returns the entity ids in commit order. */
function loadWorld(
  host: ReturnType<typeof createFieldHost>,
  commits: readonly Committed[],
): number[] {
  const store = createFieldStore();
  const log = createOpLog();
  const ids = commits.map(
    (c) =>
      commitGenerator(store, log, generatorById(c.id), {
        params: structuredClone(generatorById(c.id).defaults),
        seed: c.seed,
        region: c.region,
        policy: "replace",
        table: TABLE,
      }).entity.entityId,
  );
  host.setMaterialTable(TABLE);
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [...store.chunks].map(([key, density]) => ({
      key,
      bytes: encodeChunkFile(density),
    })),
    materials: [...store.materials].map(([key, m]) => ({
      key,
      bytes: encodeMaterialFile(m),
    })),
    oplog: serializeOps(log.ops),
  });
  return ids;
}

const HALL: Committed = { id: "hall", seed: 7, region: HALL_REGION };
const CAVE: Committed = { id: "cave", seed: 5, region: CAVE_REGION };

/** The host's LIVE op log, read back through the baked artifact (the host
 *  exposes no other window onto it). */
function hostOps(host: ReturnType<typeof createFieldHost>): FieldOp[] {
  const file = host
    .exportArtifact("probe")
    .find((f) => f.path === "worlds/probe/oplog.json");
  if (file === undefined || typeof file.contents !== "string")
    throw new Error("test: no oplog.json in the artifact");
  return parseOps(file.contents);
}

/** Installs a fake `Worker` over the REAL protocol handler (field-stamp.test.ts's
 *  recipe); returns the uninstall. A move session previews like any other, so
 *  nothing here reaches `ready` without one. */
function installFakeWorker(): () => void {
  const real = globalThis.Worker;
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    private readonly handle = createFieldWorkerHandler((msg) => {
      this.onmessage?.({ data: msg } as MessageEvent);
    });
    postMessage(msg: unknown): void {
      this.handle(msg as FieldWorkerRequest);
    }
    terminate(): void {
      // fake worker: nothing to tear down
    }
  }
  // Boundary cast: the host spawns through the DOM Worker constructor; the fake
  // implements the WorkerLike subset field-client.ts actually calls.
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  return () => {
    globalThis.Worker = real;
  };
}

/** Flush the preview promise chain (the fake worker answers synchronously; the
 *  client still resolves through microtasks). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** A host over `commits`, with the fake worker installed and the session +
 *  tool-error pushes recorded. Callers own `teardown`. */
function moveFixture(commits: readonly Committed[] = [HALL]) {
  const uninstall = installFakeWorker();
  const host = createFieldHost();
  const ids = loadWorld(host, commits);
  const sessions: (StampSession | null)[] = [];
  const errors: string[] = [];
  host.subscribeStamp((s) => sessions.push(s));
  host.subscribeToolError((m) => errors.push(m));
  return {
    host,
    ids,
    sessions,
    errors,
    session: (): StampSession | null => sessions.at(-1) ?? null,
    teardown: uninstall,
  };
}

/** The recorded region of the one entity `id` names. */
const regionOf = (
  host: ReturnType<typeof createFieldHost>,
  id: number,
): { min: number[]; max: number[] } => {
  const e = host.listEntities().find((x) => x.entityId === id);
  if (e === undefined) throw new Error(`test: no entity ${id}`);
  return e.region;
};

// --- beginMove --------------------------------------------------------------

test("beginMove opens a reconfigure session flagged `moving` on the same entity", async () => {
  const f = moveFixture();
  try {
    const id = f.ids[0] as number;
    f.host.beginMove(id);
    await settle();

    const s = f.session();
    expect(s).not.toBeNull();
    if (s === null) return;
    // A move IS a reconfigure — same session, same ghost, same terminal verb.
    // `moving` is the one thing that separates them, and it is what the session
    // card and the strip read to say "move" instead of "reconfigure".
    expect(s.mode).toBe("reconfigure");
    expect(s.moving).toBe(true);
    expect(s.entityId).toBe(id);
    expect(s.generator).toBe("hall");
    expect(s.region).toEqual(HALL_REGION);
  } finally {
    f.teardown();
  }
});

test("openEntity opens the SAME session WITHOUT the move flag", async () => {
  const f = moveFixture();
  try {
    f.host.openEntity(f.ids[0] as number);
    await settle();
    const s = f.session();
    expect(s?.mode).toBe("reconfigure");
    // Absent, not false: a plain reconfigure is not a move that happens to be
    // standing still, and the optional field is what says so.
    expect(s?.moving).toBeUndefined();
  } finally {
    f.teardown();
  }
});

test("`moving` survives the session's own transitions", async () => {
  const f = moveFixture();
  try {
    f.host.beginMove(f.ids[0] as number);
    await settle();
    // A nudge (withRegion) and a param edit (withParams) both rebuild the
    // session wholesale — the flag has to ride the spread or the card would
    // silently fall back to "reconfigure" the moment the region moved.
    f.host.nudgeStamp(1, 0, 0);
    await settle();
    expect(f.session()?.moving).toBe(true);
    const s = f.session();
    if (s === null) return;
    f.host.updateStamp(s.params, s.seed, s.policy);
    await settle();
    expect(f.session()?.moving).toBe(true);
  } finally {
    f.teardown();
  }
});

test("beginMove refuses a FROZEN and a BAKED entity, with openEntity's own words", async () => {
  const f = moveFixture([HALL, { ...HALL, seed: 8 }]);
  try {
    const [frozen, baked] = f.ids as [number, number];
    f.host.setEntityFrozen(frozen, true);
    f.host.bakeEntity(baked);

    f.host.beginMove(frozen);
    f.host.beginMove(baked);
    await settle();

    // Verbatim `openBlockedReason` — the ONE rule the row's disabled Open button
    // reads too, so a state the UI greys out and a state the host refuses can
    // never drift apart.
    expect(f.errors).toEqual([
      `entity ${frozen} is frozen — unfreeze it to edit`,
      `entity ${baked} is baked — its recipe was severed`,
    ]);
    // No session at all — a refused move must not leave a ghost offering an
    // Apply that can never land.
    expect(f.session()).toBeNull();
  } finally {
    f.teardown();
  }
});

test("beginMove on an unknown id reports rather than throwing", async () => {
  const f = moveFixture();
  try {
    expect(() => f.host.beginMove(9999)).not.toThrow();
    await settle();
    expect(f.errors).toEqual(["entity 9999 is no longer in the log"]);
    expect(f.session()).toBeNull();
  } finally {
    f.teardown();
  }
});

// --- the move lands ---------------------------------------------------------

test("a move commits through the reconfigure splice: ONE undo step, id preserved", async () => {
  const f = moveFixture();
  try {
    const id = f.ids[0] as number;
    const before = hostOps(f.host).length;

    f.host.beginMove(id);
    await settle();
    // The drag's own seam: whole lattice steps on world axes, exactly what the
    // arrow pad and the inspector d-pad drive.
    f.host.nudgeStamp(4, 0, -2);
    await settle();
    expect(f.session()?.phase).toBe("ready");

    // `confirmSession` — the verb ⏎ runs and the only one the facade still has.
    // It routes through `dropMove`, which is the point: the region moved by ARROWS
    // alone (`nudgeStamp`, no cursor travel) must still land. Before T3c this exact
    // call discarded the move, because the idle test read the drag's accumulated
    // lattice steps instead of the region — the defect this case now pins closed.
    f.host.confirmSession();

    const moved = regionOf(f.host, id);
    expect(moved.min[0]).toBeCloseTo(HALL_REGION.min[0] + 4 * LATTICE, 10);
    expect(moved.min[2]).toBeCloseTo(HALL_REGION.min[2] - 2 * LATTICE, 10);
    expect(moved.min[1]).toBeCloseTo(HALL_REGION.min[1], 10);
    // The ENTITY survived the splice — a move that re-committed would hand back
    // a new id and orphan every reference to the old one.
    expect(f.host.listEntities().map((e) => e.entityId)).toEqual([id]);
    expect(f.session()).toBeNull();

    f.host.undo();
    // ONE entry: a splice that pushed one per op would leave the hall half-moved.
    expect(regionOf(f.host, id)).toEqual(HALL_REGION);
    expect(hostOps(f.host).length).toBe(before);
  } finally {
    f.teardown();
  }
});

test("Esc during a move discards it — the entity is untouched", async () => {
  const f = moveFixture();
  try {
    const id = f.ids[0] as number;
    const before = hostOps(f.host).length;

    f.host.beginMove(id);
    await settle();
    f.host.nudgeStamp(6, 2, 0);
    await settle();
    // The GHOST moved; the record has not — nothing is written until the drop.
    expect(f.session()?.region.min[0]).toBeCloseTo(6 * LATTICE, 10);
    expect(regionOf(f.host, id)).toEqual(HALL_REGION);

    f.host.cancelStamp();

    expect(f.session()).toBeNull();
    expect(regionOf(f.host, id)).toEqual(HALL_REGION);
    expect(hostOps(f.host).length).toBe(before);
  } finally {
    f.teardown();
  }
});

// The log can move UNDER a live move: ⌘Z is bound on the canvas, and a `G` grab
// is a modal state where the canvas necessarily has focus (Esc and R depend on
// it), so this is one keypress away rather than contrived. Both halves are
// wrong and the quiet one is worse: an undone COMMIT leaves the session pointing
// at an entity that is gone (the drop fails loudly), while an undone
// RECONFIGURE leaves it pointing at an entity whose region the step just moved,
// and the drop then re-applies a placement the user has just undone — silently.
test("undo during a move ends it — the session cannot outlive the log it names", async () => {
  const f = moveFixture();
  try {
    const id = f.ids[0] as number;
    f.host.duplicateEntity(id);
    const copy = f.host.listEntities()[1]?.entityId;
    if (copy === undefined) throw new Error("test: no copy");

    f.host.beginMove(copy);
    await settle();
    f.host.nudgeStamp(3, 0, 0);
    await settle();
    expect(f.session()?.moving).toBe(true);

    f.host.undo(); // takes the duplicate back out of the log

    expect(f.host.listEntities().map((e) => e.entityId)).toEqual([id]);
    expect(f.session()).toBeNull();
  } finally {
    f.teardown();
  }
});

test("undo during a move on a SURVIVING entity ends it too — the region moved under it", async () => {
  const f = moveFixture();
  try {
    const id = f.ids[0] as number;
    // Land one real move so there is a reconfigure entry to step back over.
    f.host.beginMove(id);
    await settle();
    f.host.nudgeStamp(4, 0, 0);
    await settle();
    f.host.confirmSession();
    const moved = structuredClone(regionOf(f.host, id));
    expect(moved.min[0]).toBeCloseTo(HALL_REGION.min[0] + 4 * LATTICE, 10);

    // Now a SECOND move, undone mid-flight. The entity survives, so nothing
    // fails loudly — the session simply describes a placement relative to a
    // region the undo has already taken away.
    f.host.beginMove(id);
    await settle();
    f.host.nudgeStamp(2, 0, 0);
    await settle();

    f.host.undo();

    expect(regionOf(f.host, id)).toEqual(HALL_REGION); // back to the original
    expect(f.session()).toBeNull();
    // …and the record stays where undo put it: no ghost lands afterwards.
    expect(regionOf(f.host, id)).toEqual(HALL_REGION);
  } finally {
    f.teardown();
  }
});

test("undo ends a plain RECONFIGURE session too — not only a move", async () => {
  const f = moveFixture();
  try {
    const id = f.ids[0] as number;
    // No `beginMove` — this is the Entities row's Open button, a session with no
    // grab and no cursor driving it. Until T3c the ⌘Z guard read `stamp?.moving`,
    // so this one survived the step and left an enabled Apply on the session card
    // pointing at a record the step had already replaced. The move case was fixed
    // first only because a grab keeps the canvas focused, which made it the
    // reachable one — not because it was the only one.
    f.host.openEntity(id);
    await settle();
    expect(f.session()?.moving).toBeUndefined();
    f.host.nudgeStamp(3, 0, 0);
    await settle();

    f.host.undo(); // takes the hall's own commit back out of the log

    expect(f.session()).toBeNull();
  } finally {
    f.teardown();
  }
});

// --- R, the quarter turn ----------------------------------------------------

test("rotateStamp cycles the schema's rotation enum and re-previews", async () => {
  const f = moveFixture();
  try {
    f.host.beginMove(f.ids[0] as number);
    await settle();
    // The hall opens at the recorded params, which carry the schema default.
    expect(f.session()?.params["rotation"]).toBe("0");

    for (const expected of ["90", "180", "270", "0"]) {
      f.host.rotateStamp();
      await settle();
      expect(f.session()?.params["rotation"]).toBe(expected);
      // A rotation is a params change like any other: the ghost re-cooks, so the
      // session is READY again and Enter commits what is on screen.
      expect(f.session()?.phase).toBe("ready");
    }
    expect(f.errors).toEqual([]);
  } finally {
    f.teardown();
  }
});

test("rotateStamp on a generator with no rotation param says so, and changes nothing", async () => {
  const f = moveFixture([CAVE]);
  try {
    f.host.beginMove(f.ids[0] as number);
    await settle();
    const before = f.session()?.params;

    f.host.rotateStamp();
    await settle();

    expect(f.errors).toEqual(["cave has no rotation"]);
    expect(f.session()?.params).toEqual(before ?? {});
  } finally {
    f.teardown();
  }
});

test("rotateStamp without a session is a quiet no-op", () => {
  const f = moveFixture();
  try {
    expect(() => f.host.rotateStamp()).not.toThrow();
    expect(f.errors).toEqual([]);
    expect(f.session()).toBeNull();
  } finally {
    f.teardown();
  }
});

test("R applies to a PLAIN reconfigure session too — it is session-scoped, not move-scoped", async () => {
  const f = moveFixture();
  try {
    f.host.openEntity(f.ids[0] as number);
    await settle();
    f.host.rotateStamp();
    await settle();
    expect(f.session()?.params["rotation"]).toBe("90");
  } finally {
    f.teardown();
  }
});
