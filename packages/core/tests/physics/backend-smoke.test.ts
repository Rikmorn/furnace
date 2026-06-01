// Stage 0 — physics backend smoke test (the headless `bun:test` harness pattern).
//
// This validates the *borrowed backend* (Rapier, via @dimforge/rapier3d-compat)
// runs headless in Bun: wasm init → world step → state readback → teardown. It is
// NOT a test of furnace's `physics` wrapper — that arrives in Stage 1 and will be
// tested through `@furnace/core/physics`, never by importing the backend directly.
// The point here is to prove the borrow works in our test runtime and to fix the
// pattern future physics tests follow.
//
// Packaging note: we use the `-compat` (base64-inlined wasm) build deliberately —
// `RAPIER.init()` decodes the inlined wasm with zero `.wasm` fetch/fs plumbing, so
// the harness needs no special setup. See ADR 0001 / the CPU-physics epic §2.
//
// Known noise: rapier-compat@0.19.3 logs "using deprecated parameters for the
// initialization function" on init. It is harmless and NOT caller-fixable — it comes
// from rapier-compat's own glue passing the wasm module positionally to the
// wasm-bindgen init (an internal upstream deprecation), not from our `RAPIER.init()`
// or `new World(gravity)` calls, which are both the current public API. (This corrects
// an earlier spike note that suggested a call-site "single-object form" fix.)

import { expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";

test("rapier backend: init + step + readback (headless free-fall)", async () => {
  await RAPIER.init();

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;

  const START_Y = 10;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, START_Y, 0),
  );
  // A collider gives the body mass (default density 1.0) so gravity acts on it.
  world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);

  const STEPS = 60; // 1 second at dt = 1/60
  for (let i = 0; i < STEPS; i++) world.step();

  const y = body.translation().y;
  const drop = START_Y - y;

  // Analytic free fall over 1 s: ½·g·t² = 4.905 m. Rapier's semi-implicit Euler
  // integrator lands ~4.99 m. A generous band confirms gravity + step + readback
  // work without coupling the assertion to integrator specifics.
  expect(drop).toBeGreaterThan(4.5);
  expect(drop).toBeLessThan(5.3);

  // Exercise teardown too — World.free() cascades to its bodies/colliders.
  world.free();
});
