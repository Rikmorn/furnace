// Esc, end to end: the six cancellable states, and the ORDER one press picks
// between them. What the fixed-priority ladder (D-12) used to decide in a chain
// of ifs, `input-router.ts` now decides by recency — a state captures an entry
// when it goes live and releases it when it clears, and Esc cancels the top.
//
// This suite is the equivalence record for that swap. The router's own unit tests
// (`tests/field-host/input-router.test.ts`) pin the stack; these pin that the
// HOST still wires every rung to it, with the scenarios the old ladder's rung
// comments argued from. Two of those scenarios already had homes and are NOT
// duplicated here: the arm-with-corner pair ("Esc drops the pending CORNER first
// and the arm second", field-host-stamp-entry.gpu.test.ts) and the three-way
// anchor/entity/selection walk ("Esc cancels ONE thing per press, most recent
// intent first", field-host-camera.gpu.test.ts). Both pass unmodified.
//
// SIX became SEVEN in T3c: `pendingMove` — the sub-threshold press on an
// already-selected entity — gained the rung it never had, so Esc now cancels the
// PRESS instead of falling past it to the selection the user was pressing on.
// That case is the third scenario living with its subject rather than here
// ("Esc during a sub-threshold press cancels the PRESS, not the selection behind
// it", field-host-move.gpu.test.ts), and for a reason specific to this fixture:
// the empty store below has no pickable entity, so the state cannot be armed in
// this world at all. Every case in THIS file is unchanged by that addition —
// none of the six can stand beside a pending press.
//
// It needs a device for the reason every host GPU suite does: a click resolves
// through `cursorRay` → `screenToRay`, and there is no camera until `init` has a
// context. HERE and not in `tests/field-host/` because `bun test` runs a
// directory's own files before its subdirectories and `tests/chrome/` replaces
// `globalThis.navigator` (taking `navigator.gpu` with it) — the same placement
// note the sibling GPU suites carry.
//
// The store is left EMPTY on purpose (the pointer suite's rule): an unallocated
// chunk reads SOLID, so every click resolves against rock right at the eye and
// lands on a real world point with no camera arithmetic in the test.
import { expect, test } from "bun:test";
import type { FieldManifest, FieldOp } from "@furnace/core/field";
import { DEFAULT_CELL_SIZE } from "@furnace/core/field";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createFieldHost } from "../src/field-host/field-host.ts";
import type {
  PendingStamp,
  SelectionInfo,
  StampSession,
} from "../src/field-host/index.ts";
import { type HostListeners, makeHostCanvas } from "./_helpers/host-canvas.ts";
import { stubAnimationFrameNoop } from "./_helpers/raf.ts";

await ensureBunWebGpu();

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** One committed hall in the log, so `selectEntity` and `openEntity` have a real
 *  record to resolve — the stamp-entry suite's fixture world. */
const HALL_ENTITY_ID = 2;
const hallOps = (): FieldOp[] => [
  {
    id: 1,
    kind: "brush",
    effect: "dig",
    shape: { kind: "sphere", center: [0, 1, 0], radius: 0.5 },
  },
  {
    id: HALL_ENTITY_ID,
    kind: "entity",
    action: "place",
    entity: {
      entityId: HALL_ENTITY_ID,
      type: "generator",
      generator: "hall",
      params: {},
      seed: 7,
      region: { min: [-1, 0, -1], max: [1, 2, 1] },
      opSpan: [1, 1],
    },
  },
];

async function escapeFixture() {
  const restoreRo = installMockResizeObserver();
  const restoreRaf = stubAnimationFrameNoop();
  const listeners: HostListeners = new Map();
  const host = createFieldHost();
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [],
    oplog: JSON.stringify(hallOps()),
  });
  await host.init(await makeHostCanvas(listeners));

  const sessions: (StampSession | null)[] = [];
  host.subscribeStamp((s) => sessions.push(s));
  const pending: (PendingStamp | null)[] = [];
  host.subscribePendingStamp((p) => pending.push(p));
  const selections: (SelectionInfo | null)[] = [];
  host.subscribeSelection((s) => selections.push(s));
  const entitySelections: (number | null)[] = [];
  host.subscribeEntitySelection((id) => entitySelections.push(id));

  const click = (x: number, y: number): void => {
    const fn = listeners.get("pointerdown");
    if (fn === undefined) throw new Error("test: no pointerdown listener");
    fn({ button: 0, altKey: false, clientX: x, clientY: y, pointerId: 1 });
  };
  // Whether the canvas CLAIMED the last press. It is the router's boolean by the
  // time it reaches here, and the two witnesses together are what make "one thing
  // per press" checkable: `claimed` says a press acted at all, the seams say what
  // it acted on.
  const claimed = { preventDefault: 0, stopPropagation: 0 };
  const key = (k: string): void => {
    claimed.preventDefault = 0;
    claimed.stopPropagation = 0;
    const fn = listeners.get("keydown");
    if (fn === undefined) throw new Error("test: no keydown listener");
    fn({
      key: k,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => {
        claimed.preventDefault += 1;
      },
      stopPropagation: () => {
        claimed.stopPropagation += 1;
      },
    });
  };

  return {
    host,
    sessions,
    pending,
    selections,
    entitySelections,
    click,
    key,
    claimed,
    esc: (): void => key("Escape"),
    teardown: () => {
      host.dispose();
      restoreRaf();
      restoreRo();
    },
  };
}

type Fixture = Awaited<ReturnType<typeof escapeFixture>>;

const ACTED = { preventDefault: 1, stopPropagation: 1 };
const IGNORED = { preventDefault: 0, stopPropagation: 0 };

/** Each cancellable state, ARMED ALONE — uniform enough to table. Every case runs
 *  the same three presses: one before the arm (which must be IGNORED, so the
 *  claim after the arm means something), one that cancels, and one that finds
 *  nothing left. That triple is the whole pin for the two ANCHORS, which have no
 *  seam of their own: a surviving anchor would claim the third press. The four
 *  states that DO publish add `standing` on top, read either side of the cancel. */
const SOLO: {
  name: string;
  arm: (f: Fixture) => void;
  standing?: (f: Fixture) => boolean;
}[] = [
  {
    name: "a half-drawn box anchor",
    arm: (f) => {
      f.host.setGesture("box");
      f.click(20, 20);
    },
  },
  {
    name: "a half-drawn segment anchor",
    arm: (f) => {
      f.host.setGesture("segment");
      f.click(20, 20);
    },
  },
  {
    name: "a pending stamp arm",
    arm: (f) => f.host.startStamp("hall"),
    standing: (f) => f.pending.at(-1) !== null,
  },
  {
    name: "a live session",
    arm: (f) => {
      f.host.startStamp("hall");
      f.click(20, 20);
      f.click(44, 44); // the region-draw pair opens it, spending the arm
    },
    standing: (f) => f.sessions.at(-1) !== null,
  },
  {
    name: "a selected entity",
    arm: (f) => f.host.selectEntity(HALL_ENTITY_ID),
    standing: (f) => f.entitySelections.at(-1) === HALL_ENTITY_ID,
  },
  {
    name: "a cell selection",
    arm: (f) => {
      f.host.setGesture("box");
      f.click(20, 20);
      f.click(44, 44);
    },
    standing: (f) => f.selections.at(-1) !== null,
  },
];

for (const c of SOLO) {
  test.skipIf(!bunWebGpuAvailable())(
    `Esc cancels ${c.name} and claims the key; the next press does not`,
    async () => {
      const f = await escapeFixture();
      try {
        // Nothing captured yet, so the press travels on untouched.
        f.esc();
        expect(f.claimed).toEqual(IGNORED);

        c.arm(f);
        if (c.standing !== undefined) expect(c.standing(f)).toBe(true);

        f.esc();
        expect(f.claimed).toEqual(ACTED);
        if (c.standing !== undefined) expect(c.standing(f)).toBe(false);

        // Nothing left standing: an Esc that acts on nothing must NOT claim, or
        // the app-level registry could never see the key.
        f.esc();
        expect(f.claimed).toEqual(IGNORED);
      } finally {
        f.teardown();
      }
    },
  );
}

test.skipIf(!bunWebGpuAvailable())(
  "the session goes before the entity it was opened on",
  async () => {
    // Old rung 2 before rung 3, and the stack agrees for the reason the ladder
    // did: the session is the more recent intent. `openEntity` does NOT touch the
    // entity selection, so both are genuinely standing at once.
    const f = await escapeFixture();
    try {
      f.host.selectEntity(HALL_ENTITY_ID);
      f.host.openEntity(HALL_ENTITY_ID);
      expect(f.sessions.at(-1)).not.toBeNull();
      expect(f.entitySelections.at(-1)).toBe(HALL_ENTITY_ID);

      f.esc();
      expect(f.claimed).toEqual(ACTED);
      expect(f.sessions.at(-1)).toBeNull();
      // Untouched — which is what makes this "one thing per press" and not a
      // teardown that happens to start with the session.
      expect(f.entitySelections.at(-1)).toBe(HALL_ENTITY_ID);

      f.esc();
      expect(f.entitySelections.at(-1)).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "Esc PARKS the cell selection, so Reselect is still the way back",
  async () => {
    // Old rung 4's whole point: Esc clears through `setSelection(null)`, the same
    // call the panel's Clear makes, so an Esc that went one press too far is
    // undoable by the affordance that already exists.
    const f = await escapeFixture();
    try {
      f.host.setGesture("box");
      f.click(20, 20);
      f.click(44, 44);
      const landed = f.selections.at(-1);
      expect(landed).not.toBeNull();

      f.esc();
      expect(f.selections.at(-1)).toBeNull();

      f.host.reselect();
      expect(f.selections.at(-1)).toEqual(landed ?? null);

      // And the restored selection is CAPTURED again — a Reselect that brought
      // the overlay back but not the entry would leave a selection Esc could not
      // reach.
      f.esc();
      expect(f.claimed).toEqual(ACTED);
      expect(f.selections.at(-1)).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "switching box→segment leaves exactly ONE anchor to cancel",
  async () => {
    // The old rung 1 cleared BOTH anchors in one press. That dual clear was
    // guarding a state the arming rules make unreachable — `setGesture` drops both
    // on every switch — so each anchor now holds its own entry. The pin is that
    // the pair never stands together: one press clears the segment anchor and the
    // next finds nothing, where a surviving box anchor would claim a second time.
    const f = await escapeFixture();
    try {
      f.host.setGesture("box");
      f.click(20, 20); // a box corner is down
      f.host.setGesture("segment"); // …and the switch drops it
      f.click(30, 30); // the segment's own anchor

      f.esc();
      expect(f.claimed).toEqual(ACTED);
      f.esc();
      expect(f.claimed).toEqual(IGNORED);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a selection drawn AFTER an entity pick is cancelled first — recency, not a fixed order",
  async () => {
    // The DELIBERATE behaviour change of the ladder→stack swap, pinned so it is a
    // decision rather than a drift. The ladder always took the entity first
    // because rung 3 sat above rung 4; the stack takes whichever the user started
    // last. The two agree on the common flow (draw a region, then pick something
    // in it — that order is what field-host-camera.gpu.test.ts walks) and disagree
    // only here, where the ladder's own header promise ("most recent intent
    // first") is the one the stack keeps.
    const f = await escapeFixture();
    try {
      f.host.selectEntity(HALL_ENTITY_ID);
      f.host.setGesture("box");
      f.click(20, 20);
      f.click(44, 44);
      expect(f.selections.at(-1)).not.toBeNull();
      expect(f.entitySelections.at(-1)).toBe(HALL_ENTITY_ID);

      f.esc();
      expect(f.selections.at(-1)).toBeNull();
      expect(f.entitySelections.at(-1)).toBe(HALL_ENTITY_ID);

      f.esc();
      expect(f.entitySelections.at(-1)).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "an entity picked DURING a live session is cancelled first — the second divergence row",
  async () => {
    // §20.2's session-then-entity row, same decision as the pin above. The ladder
    // took the session (rung 2 sat above rung 3); the stack takes the pick, the
    // more recent intent. The reverse order — pick first, then open on it — is
    // the flow where the two AGREED, pinned at "the session goes before the
    // entity it was opened on".
    const f = await escapeFixture();
    try {
      f.host.startStamp("hall");
      f.click(20, 20);
      f.click(44, 44); // the region-draw pair opens the session
      f.host.selectEntity(HALL_ENTITY_ID);
      expect(f.sessions.at(-1)).not.toBeNull();
      expect(f.entitySelections.at(-1)).toBe(HALL_ENTITY_ID);

      f.esc();
      expect(f.claimed).toEqual(ACTED);
      expect(f.entitySelections.at(-1)).toBeNull();
      expect(f.sessions.at(-1)).not.toBeNull();

      f.esc();
      expect(f.sessions.at(-1)).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a selection drawn DURING a live session is cancelled first — the third divergence row",
  async () => {
    // §20.2's session-then-selection row, closing the divergence table: all three
    // rows are pinned decisions now. A live session does not own LMB — the armed
    // gesture does — so the box pair can land while the ghost stands, and Esc
    // takes the selection (most recent) where the ladder took the session. The
    // box corners land AWAY from the session's region so the presses cannot read
    // as a ghost hit.
    const f = await escapeFixture();
    try {
      f.host.startStamp("hall");
      f.click(20, 20);
      f.click(44, 44); // the region-draw pair opens the session
      f.host.setGesture("box");
      f.click(120, 120);
      f.click(150, 150); // the box pair lands the selection
      expect(f.sessions.at(-1)).not.toBeNull();
      expect(f.selections.at(-1)).not.toBeNull();

      f.esc();
      expect(f.claimed).toEqual(ACTED);
      expect(f.selections.at(-1)).toBeNull();
      expect(f.sessions.at(-1)).not.toBeNull();

      f.esc();
      expect(f.sessions.at(-1)).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a world swap releases the selection capture the bare clear leaves behind",
  async () => {
    // `resetWorld` writes `selection` directly (it must: `setSelection` would park
    // the outgoing selection in the Reselect slot, and a Reselect across a world
    // swap restores cells from a field that is gone). That bypass is exactly the
    // bug class the capture stack can suffer from — a bare write that skips the
    // reconcile leaves an entry standing for state that ended — so the reconcile
    // it does make is pinned here.
    const f = await escapeFixture();
    try {
      f.host.setGesture("box");
      f.click(20, 20);
      f.click(44, 44);
      expect(f.selections.at(-1)).not.toBeNull();

      f.host.loadWorld({ manifest: MANIFEST, chunks: [], oplog: null });
      expect(f.selections.at(-1)).toBeNull();

      // Nothing is standing, so nothing may be claimed. A leaked capture claims
      // the key and cancels a selection that stopped existing a world ago.
      f.esc();
      expect(f.claimed).toEqual(IGNORED);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "the FACADE verb answers whether it cancelled anything — `session.interrupt`'s whole branch",
  async () => {
    // The agent's Esc (foundations T4c). Every case above drives the CANVAS keydown, which is
    // the human's route; the answerer row reaches `FieldHost.escape` directly, and the
    // boolean it returns is the entire difference between "I closed your session" and
    // "nothing was standing" in the answer an agent reads
    // (`frontend/lib/session-answerers.ts`'s `session.interrupt`).
    //
    // PINNED AGAINST A REAL HOST because nothing else can: the answerer's own suite stubs
    // `escape` with a canned boolean, so it pins the branch and not the fact. Here the
    // session is genuinely live, genuinely cancelled, and the second call genuinely finds an
    // empty stack.
    const f = await escapeFixture();
    try {
      f.host.selectEntity(HALL_ENTITY_ID);
      f.host.openEntity(HALL_ENTITY_ID);
      expect(f.sessions.at(-1)).not.toBeNull();

      expect(f.host.escape()).toBe(true);
      expect(f.sessions.at(-1)).toBeNull();

      // ONE RUNG, and this is where that limit is visible: the entity the session was opened
      // on is still selected, so a second call has something to cancel and says so — and a
      // third, with the stack finally empty, is the `false` the verb refuses on.
      expect(f.entitySelections.at(-1)).toBe(HALL_ENTITY_ID);
      expect(f.host.escape()).toBe(true);
      expect(f.host.escape()).toBe(false);
    } finally {
      f.teardown();
    }
  },
);
