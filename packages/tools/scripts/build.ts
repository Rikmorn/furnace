import { resolve } from "node:path";
import {
  emitDeclarations,
  stageAssets,
  stageTypeScript,
  synthesisePackageJson,
} from "../src/internal/index.ts";

const PKG_ROOT = resolve(import.meta.dir, "..");
const WORKSPACE_ROOT = resolve(PKG_ROOT, "../..");
const DIST_TOOLS = resolve(WORKSPACE_ROOT, "dist/tools");

await stageTypeScript({
  from: resolve(PKG_ROOT, "src/public"),
  to: resolve(DIST_TOOLS, "src/public"),
});

await emitDeclarations({
  srcDir: resolve(PKG_ROOT, "src/public"),
  outDir: resolve(DIST_TOOLS, "types"),
  baseConfig: resolve(WORKSPACE_ROOT, "tsconfig.json"),
});

await synthesisePackageJson({
  workspaceManifest: resolve(PKG_ROOT, "package.json"),
  outPath: resolve(DIST_TOOLS, "package.json"),
  overrides: {
    exports: {
      "./public/cli": {
        types: "./types/cli.d.ts",
        default: "./src/public/cli.ts",
      },
    },
    files: ["src/public/**", "types/**"],
  },
});

await stageAssets({
  from: PKG_ROOT,
  to: DIST_TOOLS,
  files: ["README.md", "LICENSE"],
});

console.log(`Staged @furnace/tools publish layout at ${DIST_TOOLS}`);
