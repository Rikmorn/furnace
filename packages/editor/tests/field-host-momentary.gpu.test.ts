// The momentary tool overrides, driven through the host's OWN key listeners.
//
// `deriveMomentary` is a pure function of (saved base, ⇧ held, ⌃ held), and the property
// that matters is that any press/release interleaving lands back on the base — which means
// the interesting cases are all about what the BASE is when the modifier lets go. That is
// only reachable through the real keydown/keyup handlers: the flags are closure-private and
// no `FieldHost` member sets them.
//
// It therefore needs a device, for every host GPU suite's reason — `init` is what attaches
// the listeners at all. HERE and not in `tests/field-host/` because `bun test` runs a
// directory's own files before its subdirectories and `tests/chrome/` replaces
// `globalThis.navigator` (taking `navigator.gpu` with it) — the placement note the sibling
// GPU suites carry.
//
// WHAT IT DEFENDS, stated because the suite went green without it for a whole commit: T3b2
// Task 6 gave `setTool` a no-op value guard, and that guard's PLACEMENT — below the
// momentary branch, not above it — is a separate property from its existence. Dropping the
// guard reddens a headless case; HOISTING it reddened nothing at all, and the defect it
// lets through is a brush that changes under the user's hand when they let go of a key.
import { expect, test } from "bun:test";
import type { FieldManifest } from "@furnace/core/field";
import { DEFAULT_CELL_SIZE } from "@furnace/core/field";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createFieldHost } from "../src/field-host/field-host.ts";
import type { FieldTool, FieldToolPush } from "../src/field-host/index.ts";
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

const tool = (over: Partial<FieldTool> = {}): FieldTool => ({
  effect: "dig",
  materialId: 0,
  mask: { kind: "none" },
  smooth: { strength: 16, iterations: 1, mode: "both" },
  hollow: null,
  ...over,
});

async function momentaryFixture() {
  const restoreRo = installMockResizeObserver();
  const restoreRaf = stubAnimationFrameNoop();
  const listeners: HostListeners = new Map();
  const host = createFieldHost();
  host.loadWorld({ manifest: MANIFEST, chunks: [], oplog: null });
  await host.init(await makeHostCanvas(listeners));

  const pushes: FieldToolPush[] = [];
  host.subscribeTool((p) => pushes.push(p));
  pushes.length = 0; // the subscribe snapshot

  /** Fire the host's own handler for a modifier press or release. */
  const modifier = (type: "keydown" | "keyup", key: "Shift" | "Control") => {
    const fn = listeners.get(type);
    if (fn === undefined) throw new Error(`test: no ${type} listener`);
    fn({
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    });
  };

  /** What the seam last said the armed effect is. */
  const armed = (): string | undefined => pushes.at(-1)?.tool.effect;

  return {
    host,
    pushes,
    modifier,
    armed,
    dispose: () => {
      host.dispose();
      restoreRaf();
      restoreRo();
    },
  };
}

test.skipIf(!bunWebGpuAvailable())(
  "a setTool under a held ⇧ becomes the base the release lands on",
  async () => {
    // THE PLACEMENT CASE. Holding ⇧ makes the effective tool `smooth`, so a panel pick of
    // `smooth` while it is held asks for a value `tool` already equals — and a value guard
    // sitting ABOVE the momentary branch would return there, leaving `momentarySaved` on the
    // dig it was saved at. The user then lets go of ⇧ and their brush turns back into dig,
    // which is the brush changing under their hand.
    //
    // WHAT THIS CASE CANONISES IS THE DELIBERATE PICK, and only that. The same branch is
    // reached by any strip control nudged while a modifier is held — the controls spread
    // `ctx.tool`, which under ⇧ is the DERIVED tool, so a strength drag sends `smooth`
    // along with the strength and rewrites the base as a side effect. That is a live
    // hazard, it predates this commit (the old chrome cell held the derived tool too), and
    // it is filed rather than fixed here: `docs/backlog/editor-and-tooling/
    // param-nudge-under-a-momentary-modifier-rewrites-the-base.md`. Read the assertion
    // below as "the base adopts", not as "only a pick can make it adopt".
    //
    // Sabotage-proven: hoisting `sameTool` above the momentary branch fails THIS case, and
    // it is the only case in the package that notices.
    const f = await momentaryFixture();
    try {
      f.modifier("keydown", "Shift");
      expect(f.armed()).toBe("smooth"); // the derive fired, so the premise holds

      f.host.setTool(tool({ effect: "smooth" }));
      f.modifier("keyup", "Shift");

      expect(f.armed()).toBe("smooth");
    } finally {
      f.dispose();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a setTool under a held ⇧ that is NOT the derived tool still becomes the base",
  async () => {
    // The other side of the same branch, and the one a guard placed anywhere would pass —
    // it is here so the case above is read as being about the GUARD rather than about the
    // adopt-the-base rule in general. ⇧ derives `smooth` from a `dig` base; picking `fill`
    // under it is a real change to both, and the release lands on `fill`.
    const f = await momentaryFixture();
    try {
      f.modifier("keydown", "Shift");
      f.host.setTool(tool({ effect: "fill" }));
      // Still smooth WHILE held: the modifier owns the effective tool, the pick owns the base.
      expect(f.armed()).toBe("smooth");

      f.modifier("keyup", "Shift");

      expect(f.armed()).toBe("fill");
    } finally {
      f.dispose();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "⌃ inverts dig↔fill and restores the base on release",
  async () => {
    // The second modifier, so the fixture is not pinning ⇧ alone: ⌃ is the dig↔fill invert,
    // and with no setTool in between the release must land exactly where it started.
    const f = await momentaryFixture();
    try {
      f.host.setTool(tool({ effect: "fill" }));
      expect(f.armed()).toBe("fill");

      f.modifier("keydown", "Control");
      expect(f.armed()).toBe("dig");

      f.modifier("keyup", "Control");
      expect(f.armed()).toBe("fill");
    } finally {
      f.dispose();
    }
  },
);
