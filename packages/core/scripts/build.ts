import { resolve } from "node:path";
import {
  emitDeclarations,
  stageAssets,
  stageTypeScript,
  synthesisePackageJson,
} from "./internal/index.ts";

const PKG_ROOT = resolve(import.meta.dir, "..");
const WORKSPACE_ROOT = resolve(PKG_ROOT, "../..");
const DIST_CORE = resolve(WORKSPACE_ROOT, "dist/core");

await stageTypeScript({
  from: resolve(PKG_ROOT, "src"),
  to: resolve(DIST_CORE, "src"),
});

await emitDeclarations({
  srcDir: resolve(PKG_ROOT, "src"),
  outDir: resolve(DIST_CORE, "types"),
  baseConfig: resolve(WORKSPACE_ROOT, "tsconfig.json"),
  // @webgpu/types is not a package under @types/ so it won't resolve from a
  // temp dir. Include its declaration file explicitly so tsc can see the GPU*
  // globals during the emit pass.
  extraDeclarationFiles: [
    resolve(WORKSPACE_ROOT, "node_modules/@webgpu/types/dist/index.d.ts"),
  ],
});

await synthesisePackageJson({
  workspaceManifest: resolve(PKG_ROOT, "package.json"),
  outPath: resolve(DIST_CORE, "package.json"),
  overrides: {
    files: ["src/**", "types/**"],
  },
});

await stageAssets({
  from: PKG_ROOT,
  to: DIST_CORE,
  files: ["README.md", "LICENSE"],
});

console.log(`Staged @furnace/core publish layout at ${DIST_CORE}`);
