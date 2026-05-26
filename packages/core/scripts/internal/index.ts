export type {
  EmitDeclarationsOptions,
  StageAssetsOptions,
  StageAssetsResult,
  StageTypeScriptOptions,
  SynthesisePackageJsonOptions,
} from "./publish.ts";
export {
  emitDeclarations,
  stageAssets,
  stageTypeScript,
  synthesisePackageJson,
} from "./publish.ts";
export type { TsdocViolation } from "./tsdoc-check.ts";
export { checkTsdocForModule } from "./tsdoc-check.ts";
