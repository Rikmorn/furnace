import { expect, test } from "bun:test";
import { join } from "node:path";
import { createEngineBundler } from "../src/daemon/bundle.ts";

// NOTE ON WHAT THESE TESTS PROVE: the fixture has no own node_modules, so its
// imports resolve up to the *workspace* node_modules — the same one the editor
// uses. These tests therefore prove bundle CONTAINMENT (the right symbols land
// in one ESM string), not resolution ORIGIN (project-first vs editor-relative
// are indistinguishable when they share a node_modules). The single-instance /
// project-first invariant is exercised by the Task 6 GPU gate (one core
// instance drives registration → reflection → load). In production the consumer
// must carry @furnace/editor in its own node_modules; bundling from a root
// outside the workspace fails to resolve @furnace/editor/viewport-host — the
// expected project-first behavior.
const FIXTURE = join(import.meta.dir, "fixtures", "mini-project");

test("bundles the fixture project's extensions + viewport-host into one ESM string", async () => {
  const bundler = await createEngineBundler(
    FIXTURE,
    "src/editor-extensions.ts",
  );
  const result = await bundler.build();
  if (!result.ok) throw new Error(result.error);
  expect(result.code).toContain("fixtureGlow"); // extension registration made it in
  expect(result.code).toContain("createViewportHost"); // host export made it in
  expect(result.code).toContain("createPreviewHost"); // preview host export made it in
  expect(result.code).toContain("extensions"); // consumer extensions namespace re-exported
  await bundler.dispose();
});

test("rebuild after dispose-less second call works (incremental context)", async () => {
  const bundler = await createEngineBundler(
    FIXTURE,
    "src/editor-extensions.ts",
  );
  const first = await bundler.build();
  const second = await bundler.build();
  expect(first.ok && second.ok).toBe(true);
  await bundler.dispose();
});

test("a broken extension yields ok:false with esbuild diagnostics, not a throw", async () => {
  const bundler = await createEngineBundler(FIXTURE, "src/does-not-exist.ts");
  const result = await bundler.build();
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("does-not-exist");
  await bundler.dispose();
});

test("no extensions entry: bundle still exports the host (built-ins only)", async () => {
  const bundler = await createEngineBundler(FIXTURE, undefined);
  const result = await bundler.build();
  if (!result.ok) throw new Error(result.error);
  expect(result.code).toContain("createViewportHost");
  expect(result.code).toContain("createPreviewHost");
  // No extensions entry → the bundle still exports an (empty) `extensions` const.
  expect(result.code).toContain("extensions");
  expect(result.code).not.toContain("fixtureGlow");
  await bundler.dispose();
});
