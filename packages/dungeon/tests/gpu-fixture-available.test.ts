// The un-gated availability claim for DUNGEON's copy of the bun-webgpu fixture.
//
// Why a second one exists: every dungeon GPU case gates on `test.skipIf(!bunWebGpuAvailable())`
// against this package's own fixture, so a regression confined to this copy converts the whole
// dungeon GPU tier into silent skips and leaves the gate exit 0. Measured at the
// isolate-hardening review by neutralising this fixture's `resolveBunWebGpuLib` — the dungeon
// GPU cases dropped out and `bun run test` still passed, because the suite's only un-gated
// claim (`gpu-fixture-survives-dom.test.ts`) is written against CORE's copy and was unaffected.
//
// This file is the narrowest thing that makes that loud. It deliberately does NOT repeat the
// happy-dom ordering proof its core-side counterpart carries — dungeon registers no DOM, and
// duplicating that would duplicate the reasoning too.
//
// The duplication itself — whether two fixtures should exist at all — is still open:
// `docs/backlog/testing-and-quality/two-gpu-fixtures-duplicated.md`.
import { expect, test } from "bun:test";
import { ensureBunWebGpu } from "./_helpers/gpu-fixture.ts";

test("dungeon's own bun-webgpu fixture acquires a device", async () => {
  expect(await ensureBunWebGpu()).toBe(true);
});
