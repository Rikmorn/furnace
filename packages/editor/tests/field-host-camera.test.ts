// FieldHost's two public camera verbs (F4.5b Task 6), headless: `frameSelection`
// (F) and `snapView` (the corner triad's tips).
//
// Neither needs a GPU — both are pure `orbitState` writes ending at `applyOrbit`,
// which publishes the pose ABOVE its own camera guard. The camera-driven half of
// the task — wheel dolly vs brush radius, RMB orbit vs fly-look, and the cell
// selection `frameSelection` falls back to — lives in `field-host-camera.gpu.test.ts`,
// because every one of those needs `cursorRay`, and there is no camera until
// `init` has acquired a context.
//
// HERE and not in `tests/viewport-host/`: that directory holds this slice's PURE
// module tests (camera-control, field-move, field-pick…), and `bun test` walks a
// directory's own files before its subdirectories — `tests/chrome/` registers
// happy-dom, which replaces `globalThis.navigator`. Every headless FieldHost
// suite is a `tests/` root file for that reason.
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
  serializeOps,
} from "@furnace/core/field";
import {
  frameBox,
  type OrbitState,
  toEyeTarget,
} from "../src/viewport-host/camera-control.ts";
import { generatorFootprint } from "../src/viewport-host/field-ghost.ts";
import type { CameraPose } from "../src/viewport-host/field-host.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";

type V3 = [number, number, number];

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

/** Deliberately OFF the origin and lopsided, so a framing that centred on the
 *  world origin, or on the wrong corner, or fitted the wrong edge, all show. */
const HALL_REGION = {
  min: [4, 0, 2] as V3,
  max: [12, 4, 5] as V3,
};

/** Commits one hall with core and hands the whole world to `host` — the only
 *  headless route to a committed entity. Returns its id and the log it came from. */
function loadHall(host: ReturnType<typeof createFieldHost>): {
  entityId: number;
  ops: FieldOp[];
} {
  const store = createFieldStore();
  const log = createOpLog();
  const { entity } = commitGenerator(store, log, generatorById("hall"), {
    params: structuredClone(generatorById("hall").defaults),
    seed: 7,
    region: HALL_REGION,
    policy: "replace",
    table: TABLE,
  });
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
  return { entityId: entity.entityId, ops: log.ops };
}

/** The entity's footprint box, read the way the HOST reads it (field-ghost's
 *  `generatorFootprint`, recorded region as the null fallback) rather than
 *  hand-computed — a literal could not notice the footprint moving. */
function footprint(ops: FieldOp[], entityId: number): { min: V3; max: V3 } {
  const op = ops.find(
    (o) => o.kind === "entity" && o.entity.entityId === entityId,
  );
  if (op === undefined || op.kind !== "entity")
    throw new Error("test: no entity op for that id");
  return (
    generatorFootprint(ops, op.entity, DEFAULT_CELL_SIZE) ?? op.entity.region
  );
}

/** Read `cameraEye()` back out of the artifact manifest (`playerStart`) —
 *  field-stamp.test.ts's probe, and still the only window onto the orbit target
 *  and distance: the pose seam publishes yaw/pitch alone. */
function readCameraEye(host: ReturnType<typeof createFieldHost>): V3 {
  const manifestFile = host
    .exportArtifact("probe")
    .find((f) => f.path === "worlds/probe/manifest.json");
  if (manifestFile === undefined || typeof manifestFile.contents !== "string")
    throw new Error("test: no manifest.json in the artifact");
  return (JSON.parse(manifestFile.contents) as { playerStart: V3 }).playerStart;
}

/** A host plus a running record of every pose the seam pushed. */
function poseProbe(): {
  host: ReturnType<typeof createFieldHost>;
  poses: CameraPose[];
} {
  const host = createFieldHost();
  const poses: CameraPose[] = [];
  host.subscribeCameraPose((p) => poses.push(p));
  return { host, poses };
}

const lastPose = (poses: CameraPose[]): CameraPose => {
  const p = poses.at(-1);
  if (p === undefined) throw new Error("test: the pose seam pushed nothing");
  return p;
};

// --- frameSelection ---------------------------------------------------------

test("frameSelection with nothing selected moves no camera and pushes no pose", () => {
  const { host, poses } = poseProbe();
  loadHall(host);
  const eyeBefore = readCameraEye(host);
  const pushes = poses.length;

  host.frameSelection();

  expect(readCameraEye(host)).toEqual(eyeBefore);
  // A no-op that still published would repaint the triad for nothing, and would
  // hide a framing that silently framed the world origin.
  expect(poses.length).toBe(pushes);
});

test("frameSelection fits the SELECTED entity's footprint and keeps the viewing angle", () => {
  const { host, poses } = poseProbe();
  const { entityId, ops } = loadHall(host);
  const before = lastPose(poses);
  host.selectEntity(entityId);

  host.frameSelection();

  // Stated through `frameBox` because that IS the claim at this level — the host
  // frames the selected entity's footprint from the pose it is already at. The
  // fit arithmetic itself (centre, longest edge × 1.8, floored at 2 m) is pinned
  // against literals in tests/viewport-host/camera-control.test.ts.
  const pose = lastPose(poses);
  const fitted: OrbitState = frameBox(
    { target: [0, 0, 0], distance: 0, yaw: pose.yaw, pitch: pose.pitch },
    footprint(ops, entityId),
  );
  const eye = readCameraEye(host);
  const expected = toEyeTarget(fitted).eye;
  for (let i = 0; i < 3; i++)
    expect(eye[i] as number).toBeCloseTo(expected[i] as number, 6);

  // A FIT, not a flight: framing shows the thing from where the user already
  // was. (The push still happens — every camera path publishes.)
  expect(pose).toEqual(before);
});

test("frameSelection goes back to a no-op when the selected entity leaves the log", () => {
  const { host, poses } = poseProbe();
  const { entityId } = loadHall(host);
  host.selectEntity(entityId);
  host.frameSelection();
  const framed = readCameraEye(host);

  // The delete invalidates the selection (it clears the id and the box); framing
  // must not keep pointing at geometry that is gone.
  host.deleteEntity(entityId);
  const pushes = poses.length;
  host.frameSelection();

  expect(readCameraEye(host)).toEqual(framed);
  expect(poses.length).toBe(pushes);
});

// --- snapView ---------------------------------------------------------------

/** The six views, and where each puts the EYE relative to the pivot. `sign: 1`
 *  is the POSITIVE side of the named axis — the convention the triad's tips are
 *  labelled with. */
const VIEWS: ["x" | "y" | "z", 1 | -1, V3][] = [
  ["x", 1, [1, 0, 0]],
  ["x", -1, [-1, 0, 0]],
  ["y", 1, [0, 1, 0]],
  ["y", -1, [0, -1, 0]],
  ["z", 1, [0, 0, 1]],
  ["z", -1, [0, 0, -1]],
];

test("snapView puts the eye on the named side and keeps the framing it snapped from", () => {
  const { host, poses } = poseProbe();
  const { entityId, ops } = loadHall(host);
  host.selectEntity(entityId);
  // Frame first, so the pivot and the range are KNOWN numbers rather than the
  // host's private defaults — that is what makes "the framing survives" checkable.
  host.frameSelection();
  const box = footprint(ops, entityId);
  const centre: V3 = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const longest = Math.max(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  );
  const range = Math.max(2, longest * 1.8);

  for (const [axis, sign, direction] of VIEWS) {
    const pushes = poses.length;
    host.snapView(axis, sign);
    expect(poses.length).toBe(pushes + 1); // the triad has to learn about it

    const eye = readCameraEye(host);
    for (let i = 0; i < 3; i++) {
      const expected = (centre[i] as number) + range * (direction[i] as number);
      // The two Y views sit one hundredth of a radian off the pole (the shared
      // pitch clamp), which at this range is a couple of centimetres of leak
      // into the horizontal axes. 0.1 m covers it and still fails any view that
      // is actually pointing somewhere else.
      expect(Math.abs((eye[i] as number) - expected)).toBeLessThan(0.1);
    }
  }
});

test("snapView writes the axis angles, and the Y views keep the compass heading", () => {
  const { host, poses } = poseProbe();
  const heading = lastPose(poses).yaw;

  host.snapView("z", 1);
  expect(lastPose(poses)).toEqual({ yaw: 0, pitch: 0 });
  host.snapView("x", 1);
  expect(lastPose(poses)).toEqual({ yaw: Math.PI / 2, pitch: 0 });
  host.snapView("z", -1);
  expect(lastPose(poses)).toEqual({ yaw: Math.PI, pitch: 0 });
  host.snapView("x", -1);
  expect(lastPose(poses)).toEqual({ yaw: -Math.PI / 2, pitch: 0 });

  // Yaw is undefined straight up, so the top view keeps whatever heading the
  // camera had — here the one the LAST snap wrote, not the starting one.
  host.snapView("y", 1);
  expect(lastPose(poses).yaw).toBe(-Math.PI / 2);
  expect(lastPose(poses).pitch).toBeCloseTo(Math.PI / 2 - 0.01, 6);
  host.snapView("y", -1);
  expect(lastPose(poses).pitch).toBeCloseTo(-(Math.PI / 2 - 0.01), 6);
  // …and the starting heading was not it, so the assertion above is not vacuous.
  expect(heading).not.toBe(-Math.PI / 2);
});

test("snapView needs no selection — it is a view verb, not a selection one", () => {
  const { host, poses } = poseProbe();
  const pushes = poses.length;
  host.snapView("z", -1);
  expect(poses.length).toBe(pushes + 1);
  expect(lastPose(poses)).toEqual({ yaw: Math.PI, pitch: 0 });
});
