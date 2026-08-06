// The live session's PARAM bookkeeping (F4.5b Task 10), headless: which keys the user has
// spoken about, and what happens to the ones they have not when the archetype changes.
//
// The rule (D-25's "defaults behave"): a scatter session opened on rock and re-pointed at
// stalagmite should take stalagmite's authored hints for every param the user left alone,
// and keep the ones they set. The alternative readings are both wrong in a way a user
// notices — re-seed everything and their density edit silently vanishes; re-seed nothing
// and the new archetype arrives wearing the old one's spacing.
//
// It lives in the HOST rather than in the card, and that is not a preference: the hints
// come off the installed entity catalog, which the chrome deliberately does not carry (see
// `CatalogState.entityCatalogTick` — "handing over the parsed catalog would invite a
// consumer to read it instead of re-reading the host"). The touched-key set is therefore
// host state too, so that one actor owns both halves of the question.
//
// HERE and not in `tests/viewport-host/` — the field-host-move.test.ts rule: that directory
// holds the pure module tests, and `bun test` walks `tests/chrome/` (which registers
// happy-dom) before any sibling subdirectory. Every headless FieldHost suite is a `tests/`
// root file.
//
// The world arrives through `loadWorld` for field-stamp.test.ts's reason: it is the only
// headless route to a committed entity, and `openEntity` on one is the only headless route
// to a live session (a fresh stamp needs a pointer-made selection there is no seam for).
import { expect, test } from "bun:test";
import type { FieldManifest, MaterialTable } from "@furnace/core/field";
import {
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  encodeMaterialFile,
  generatorById,
  serializeOps,
} from "@furnace/core/field";
import type { EntityCatalog } from "../src/shared/catalog.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FieldWorkerRequest } from "../src/viewport-host/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/viewport-host/field-protocol.ts";
import type { StampSession } from "../src/viewport-host/field-stamp.ts";

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

/** TWO archetypes whose hints differ on BOTH keys under test. One archetype cannot
 *  discriminate anything here — the whole claim is about what changes when the id does. */
const ENTITY_CATALOG: EntityCatalog = {
  archetypes: [
    {
      id: "rock",
      name: "Rock",
      color: [0.45, 0.42, 0.4],
      collision: { kind: "box", halfExtents: [0.4, 0.35, 0.4] },
      scatter: { density: 0.3, minSpacing: 1 },
    },
    {
      id: "stalagmite",
      name: "Stalagmite",
      color: [0.5, 0.48, 0.44],
      collision: { kind: "capsule", halfHeight: 0.5, radius: 0.22 },
      scatter: { density: 0.15, minSpacing: 0.6 },
    },
  ],
};

/** A cave big enough that its floors reliably take props (field-stamp's figure). */
const CAVE_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [12, 8, 12] as [number, number, number],
};

/** The scatter as it was COMMITTED: schema defaults with a density nobody would confuse
 *  with either archetype's hint, so a value seen later names where it came from. */
const COMMITTED_DENSITY = 0.8;

const scatterParams = (): Record<string, unknown> => ({
  ...structuredClone(generatorById("scatter").defaults),
  density: COMMITTED_DENSITY,
});

/** Installs a fake `Worker` over the REAL protocol handler (field-stamp.test.ts's recipe);
 *  returns the uninstall. Every session here previews, so nothing reaches `ready` without
 *  one. */
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

/** Flush the preview promise chain (the fake worker answers synchronously; the client
 *  still resolves through microtasks). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** A host holding ONE committed scatter over a cave (the cave is what gives the scatter
 *  surfaces to land on), with the two-archetype catalog installed and the session pushes
 *  recorded. Callers own `teardown`. */
function scatterFixture() {
  const uninstall = installFakeWorker();
  const host = createFieldHost();
  const store = createFieldStore();
  const log = createOpLog();
  commitGenerator(store, log, generatorById("cave"), {
    params: structuredClone(generatorById("cave").defaults),
    seed: 5,
    region: CAVE_REGION,
    policy: "replace",
    table: TABLE,
  });
  const scatterId = commitGenerator(store, log, generatorById("scatter"), {
    params: scatterParams(),
    seed: 3,
    region: CAVE_REGION,
    policy: "replace",
    table: TABLE,
  }).entity.entityId;
  host.setMaterialTable(TABLE);
  host.setEntityCatalog(ENTITY_CATALOG);
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
  const sessions: (StampSession | null)[] = [];
  host.subscribeStamp((s) => sessions.push(s));
  return {
    host,
    scatterId,
    session: (): StampSession => {
      const s = sessions.at(-1);
      if (s === null || s === undefined) throw new Error("test: no session");
      return s;
    },
    teardown: uninstall,
  };
}

/** Push an edit through the ONE seam the card uses, carrying the session's own seed and
 *  policy — exactly what `SessionCard` does. */
const edit = (
  f: ReturnType<typeof scatterFixture>,
  patch: Record<string, unknown>,
): void => {
  const s = f.session();
  f.host.updateStamp({ ...s.params, ...patch }, s.seed, s.policy);
};

test("switching archetype mid-session re-seeds the UNTOUCHED params and keeps the touched ones", async () => {
  const f = scatterFixture();
  try {
    f.host.openEntity(f.scatterId);
    await settle();
    // The session opens on the RECORD, not on the archetype: the committed density is
    // what a reconfigure has to show, or the form would silently propose a different
    // stamp from the one on screen.
    expect(f.session().params["density"]).toBe(COMMITTED_DENSITY);
    expect(f.session().params["minSpacing"]).toBe(1);

    // The user speaks about density and nothing else.
    edit(f, { density: 0.42 });
    await settle();
    expect(f.session().params["density"]).toBe(0.42);

    // …then re-points the stamp at a different archetype.
    edit(f, { archetypeId: "stalagmite" });
    await settle();
    const after = f.session().params;
    expect(after["archetypeId"]).toBe("stalagmite");
    // The key the user never touched takes the new archetype's authored hint. A host that
    // re-seeded NOTHING leaves this at the committed 1.
    expect(after["minSpacing"]).toBe(0.6);
    // …and the key they did keeps their number. A host that re-seeded EVERYTHING makes
    // this stalagmite's 0.15, which is the same defect from the other side.
    expect(after["density"]).toBe(0.42);
  } finally {
    f.teardown();
  }
});

test("with nothing touched, switching archetype re-seeds EVERY hint it carries", async () => {
  const f = scatterFixture();
  try {
    f.host.openEntity(f.scatterId);
    await settle();
    edit(f, { archetypeId: "stalagmite" });
    await settle();
    const after = f.session().params;
    // Both hints land — including the density the RECORD carried, because the user has
    // not spoken about it in this session. (0.8 is neither archetype's hint, so this
    // cannot pass by the record and the hint agreeing.)
    expect(after["density"]).toBe(0.15);
    expect(after["minSpacing"]).toBe(0.6);
  } finally {
    f.teardown();
  }
});

test("the touched set is per-SESSION — a re-opened session starts having heard nothing", async () => {
  const f = scatterFixture();
  try {
    f.host.openEntity(f.scatterId);
    await settle();
    edit(f, { density: 0.42 });
    await settle();
    f.host.cancelStamp();

    // A fresh session on the same entity. The density edit above was discarded with the
    // session it belonged to, so it is not a claim about THIS one.
    f.host.openEntity(f.scatterId);
    await settle();
    expect(f.session().params["density"]).toBe(COMMITTED_DENSITY);
    edit(f, { archetypeId: "stalagmite" });
    await settle();
    // …so density re-seeds. A host that leaked the previous session's touched keys would
    // hold it at the committed 0.8.
    expect(f.session().params["density"]).toBe(0.15);
  } finally {
    f.teardown();
  }
});

test("an update that changes no param touches nothing — a re-roll is not an edit", async () => {
  const f = scatterFixture();
  try {
    f.host.openEntity(f.scatterId);
    await settle();
    // The card pushes the WHOLE params record on a seed or policy change (the seam takes
    // all three together). If that counted as touching every key, the first re-roll would
    // freeze the archetype hints for the rest of the session.
    const s0 = f.session();
    f.host.updateStamp({ ...s0.params }, 4242, "keep-existing-air");
    await settle();
    expect(f.session().seed).toBe(4242);
    edit(f, { archetypeId: "stalagmite" });
    await settle();
    expect(f.session().params["density"]).toBe(0.15);
    expect(f.session().params["minSpacing"]).toBe(0.6);
  } finally {
    f.teardown();
  }
});

// `usesSeed` is core's declaration (F4.5b Task 1) and the card's seed row is gated on it.
// It reaches the chrome ONLY through this projection — `FieldGeneratorInfo` is everything
// the chrome knows about a generator, because it cannot value-import the registry.
test("listGenerators carries each generator's usesSeed declaration", () => {
  const host = createFieldHost();
  const byId = new Map(host.listGenerators().map((g) => [g.id, g]));
  // Both directions, because the two mistakes are not symmetric (Task 1's finding): a
  // `true` that should be `false` leaves a dead re-roll, a `false` that should be `true`
  // silently hides a control that would have worked.
  expect(byId.get("hall")?.usesSeed).toBe(false);
  expect(byId.get("maze")?.usesSeed).toBe(true);
  expect(byId.get("cave")?.usesSeed).toBe(true);
  expect(byId.get("scatter")?.usesSeed).toBe(true);
});
