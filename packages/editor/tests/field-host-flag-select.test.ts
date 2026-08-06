// FieldHost's flag SELECTION (F4.5b Task 13, D-F4.5-15): what `selectFlag`
// accepts, what it refuses, what the flags seam then publishes, and where the
// camera goes.
//
// Headless — the whole path is store state plus an orbit write. The marker
// emphasis it drives is an instanced UPLOAD and therefore not observable from
// here or from a GPU test either (nothing reads instance data back); its decision
// is the pure `flagMarkerStyle`, pinned in tests/viewport-host/field-flags.ts.
// What IS pinned here is everything a user can reach: the refusal, the seam, the
// camera, and the world-reset clear.
//
// HERE and not in `tests/viewport-host/`, for the reason field-host-history.test.ts
// states: that directory holds this slice's PURE module tests, and `bun test` runs
// `tests/chrome/` — which registers happy-dom and replaces `globalThis.navigator` —
// before any sibling subdirectory, so a host suite there passes alone and fails in
// the full run.
import { expect, test } from "bun:test";
import type {
  AgentProfile,
  ChunkKey,
  FieldFlag,
  FieldManifest,
} from "@furnace/core/field";
import {
  AIR,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  SOLID,
} from "@furnace/core/field";
import type {
  AnalyzerRequest,
  AnalyzerResponse,
} from "../src/viewport-host/analyzer-protocol.ts";
import { createAnalyzerWorkerHandler } from "../src/viewport-host/analyzer-protocol.ts";
import type { WorkerLike } from "../src/viewport-host/field-client.ts";
import { flagCellBox } from "../src/viewport-host/field-flags.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FlagsSummary } from "../src/viewport-host/index.ts";

type V3 = [number, number, number];

/** The dungeon's shipped capsule as a literal (the analyzer tests' rationale: the
 *  editor is project-first and pins nobody's numbers). Any profile will do — its
 *  only job here is to make the advisor run at all. */
const AGENT: AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
  skin: 0.08,
};

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [1, 1.2, 1],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** One chunk with a carved slab, so the world has something to analyse and the
 *  host posts an analyze job we can answer. */
function carvedChunk(): Uint8Array {
  const density = new Int8Array(CHUNK_SAMPLES).fill(SOLID);
  for (let z = 2; z < 13; z++)
    for (let y = 4; y < 12; y++)
      for (let x = 2; x < 13; x++)
        density[x + CHUNK_DIM * (y + CHUNK_DIM * z)] = AIR;
  return encodeChunkFile(density);
}

const flagAt = (
  kind: FieldFlag["kind"],
  severity: FieldFlag["severity"],
  cell: V3,
): FieldFlag => ({
  kind,
  severity,
  cell,
  world: [
    cell[0] * DEFAULT_CELL_SIZE,
    cell[1] * DEFAULT_CELL_SIZE,
    cell[2] * DEFAULT_CELL_SIZE,
  ],
  chunk: chunkKey(0, 0, 0),
});

/** A host wired to a fake analyzer worker whose "thread" is the real protocol
 *  handler, with the chunk world loaded and an analyze posted — so exactly one
 *  canned `respond` is armed (the analyzer suite's `loadedFixture` shape). */
function fixture() {
  const sent: AnalyzerRequest[] = [];
  let lastJob: number | null = null;
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(msg) {
      const req = structuredClone(msg) as AnalyzerRequest;
      if (req.kind === "analyze") lastJob = req.jobId;
      sent.push(req);
    },
    terminate() {
      // no thread to tear down
    },
  };
  createAnalyzerWorkerHandler({
    post: (res: AnalyzerResponse) =>
      worker.onmessage?.({ data: res } as MessageEvent),
    loadEngine: () => Promise.reject(new Error("no engine wired in this test")),
  });
  const host = createFieldHost({ spawnAnalyzer: () => worker });
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const pushes: FlagsSummary[] = [];
  host.subscribeFlags((s) => pushes.push(s));
  host.setAgentProfile(AGENT);
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [{ key: chunkKey(0, 0, 0), bytes: carvedChunk() }],
    oplog: null,
  });
  /** Answer the most recent analyze with a CANNED payload — this file is about
   *  the host's reaction to findings, not about what the column pass would really
   *  have found. */
  const respond = async (
    flags: FieldFlag[],
    pits?: FieldFlag[],
  ): Promise<void> => {
    if (lastJob === null)
      throw new Error("test: no analyze has been posted to respond to");
    worker.onmessage?.({
      data: {
        kind: "flags",
        jobId: lastJob,
        chunks: [{ key: chunkKey(0, 0, 0) as ChunkKey, flags }],
        ...(pits !== undefined && { pits }),
      },
    } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { host, errors, pushes, respond };
}

const lastSummary = (pushes: readonly FlagsSummary[]): FlagsSummary => {
  const s = pushes.at(-1);
  if (s === undefined) throw new Error("test: no flags summary was pushed");
  return s;
};

/** Read `cameraEye()` back out of the artifact manifest — field-host-camera's
 *  probe, and still the only window onto the orbit target and distance (the pose
 *  seam publishes yaw/pitch alone). */
function readCameraEye(host: ReturnType<typeof createFieldHost>): V3 {
  const manifestFile = host
    .exportArtifact("probe")
    .find((f) => f.path === "worlds/probe/manifest.json");
  if (manifestFile === undefined || typeof manifestFile.contents !== "string")
    throw new Error("test: no manifest.json in the artifact");
  return (JSON.parse(manifestFile.contents) as { playerStart: V3 }).playerStart;
}

const NARROW: V3 = [6, 5, 6];

test("selecting a visible finding publishes its key on the flags seam", async () => {
  const f = fixture();
  await f.respond([flagAt("narrow", "candidate", NARROW)]);
  const key = lastSummary(f.pushes).visible[0]?.key;
  if (key === undefined) throw new Error("test: no visible row");
  // Nothing is selected until something selects it — otherwise the assertion
  // below could not tell a working seam from a default.
  expect(lastSummary(f.pushes).selected).toBeNull();

  f.host.selectFlag(key);

  expect(lastSummary(f.pushes).selected).toBe(key);
  // The seam is ONE slot carrying both facts (the plan's "one seam, not two"):
  // the rows and the selection arrive in the same push, so a palette can never
  // render a highlight against a row list from a different response.
  expect(lastSummary(f.pushes).visible.map((r) => r.key)).toEqual([key]);
  expect(f.errors).toEqual([]);
});

test("an unknown key is REFUSED and leaves the standing selection alone", async () => {
  const f = fixture();
  await f.respond([flagAt("narrow", "candidate", NARROW)]);
  const key = lastSummary(f.pushes).visible[0]?.key;
  if (key === undefined) throw new Error("test: no visible row");
  f.host.selectFlag(key);
  const pushes = f.pushes.length;

  // The stale-key case the palette can reach for real: a row click racing a
  // re-analysis that retired the finding. Same sentence `verifyFlag` refuses with,
  // deliberately — one wording for one situation.
  f.host.selectFlag("narrow@999,999,999");

  expect(f.errors.at(-1)).toContain("re-analyzed away");
  // A refusal is not a deselect: the finding the user had is still theirs.
  expect(lastSummary(f.pushes).selected).toBe(key);
  // …and it publishes nothing, so a refusal cannot repaint every flag surface.
  expect(f.pushes.length).toBe(pushes);
});

test("selectFlag(null) clears, and says nothing while doing it", async () => {
  const f = fixture();
  await f.respond([flagAt("narrow", "candidate", NARROW)]);
  const key = lastSummary(f.pushes).visible[0]?.key;
  if (key === undefined) throw new Error("test: no visible row");
  f.host.selectFlag(key);

  f.host.selectFlag(null);

  expect(lastSummary(f.pushes).selected).toBeNull();
  // `null` is the deselect, not an unknown key: it must never take the refusal
  // path, or Esc-style clearing would toast on every press.
  expect(f.errors).toEqual([]);
});

test("selecting a flag frames its CELL, not its chunk", async () => {
  const f = fixture();
  await f.respond([flagAt("narrow", "candidate", NARROW)]);
  const row = lastSummary(f.pushes).visible[0];
  if (row === undefined) throw new Error("test: no visible row");
  const eyeBefore = readCameraEye(f.host);
  // The click-to-frame goes through `aimCamera`, so it LATCHES: the chrome's Open
  // reads `cameraAimedByHand` to decide whether to frame the world it just opened,
  // and a camera the user pointed at a finding is a camera they arranged. The
  // `false` half is what makes it non-vacuous — loading the world did not latch.
  expect(f.host.cameraAimedByHand()).toBe(false);

  f.host.selectFlag(row.key);

  expect(f.host.cameraAimedByHand()).toBe(true);
  const eye = readCameraEye(f.host);
  expect(eye).not.toEqual(eyeBefore);
  // The camera ends up close enough to see a 0.25 m cell. The F4 gate's finding
  // was that the old `frameChunks` route framed the whole 4 m CHUNK — so the claim
  // that matters is the ORDER OF MAGNITUDE of the distance, checked against the
  // chunk box the old behaviour would have produced.
  const cell = flagCellBox(row.flag.world, DEFAULT_CELL_SIZE);
  const centre: V3 = [
    (cell.min[0] + cell.max[0]) / 2,
    (cell.min[1] + cell.max[1]) / 2,
    (cell.min[2] + cell.max[2]) / 2,
  ];
  const distance = Math.hypot(
    eye[0] - centre[0],
    eye[1] - centre[1],
    eye[2] - centre[2],
  );
  const chunkSpan = CHUNK_DIM * DEFAULT_CELL_SIZE; // 4 m — one chunk edge
  expect(distance).toBeLessThan(chunkSpan);
  // Non-vacuous in the other direction: it does not fly INTO the cell either
  // (camera-control floors the fit distance, so this is a real bound).
  expect(distance).toBeGreaterThan(0);
});

test("a world reset takes the selection with it", async () => {
  const f = fixture();
  await f.respond([flagAt("narrow", "candidate", NARROW)]);
  const key = lastSummary(f.pushes).visible[0]?.key;
  if (key === undefined) throw new Error("test: no visible row");
  f.host.selectFlag(key);
  expect(lastSummary(f.pushes).selected).toBe(key);

  f.host.newWorld();

  // The key names a finding in a world that no longer exists. If the next world's
  // analyzer happened to find the same kind at the same cell, a retained key would
  // silently select it — a selection the user never made, in a world they just
  // created.
  expect(lastSummary(f.pushes).selected).toBeNull();
});

test("hiding the selected finding's band un-publishes it; showing it again brings it back", async () => {
  const f = fixture();
  await f.respond([flagAt("ledge", "info", NARROW)], []);
  f.host.setFlagFilters({
    candidates: true,
    info: true,
    unreachable: false,
    pits: true,
  });
  const key = lastSummary(f.pushes).visible[0]?.key;
  if (key === undefined) throw new Error("test: no visible row");
  f.host.selectFlag(key);
  expect(lastSummary(f.pushes).selected).toBe(key);

  f.host.setFlagFilters({
    candidates: true,
    info: false,
    unreachable: false,
    pits: true,
  });
  expect(lastSummary(f.pushes).selected).toBeNull();
  // A filter HIDES; it never deletes (the advisor posture). So the selection is
  // still the user's — the seam simply stops claiming a row that is not on screen.
  expect(lastSummary(f.pushes).total).toBe(1);

  f.host.setFlagFilters({
    candidates: true,
    info: true,
    unreachable: false,
    pits: true,
  });
  expect(lastSummary(f.pushes).selected).toBe(key);
});
