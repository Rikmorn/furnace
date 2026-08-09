// `@furnace/editor/action-registry` — the editor's verbs as DATA, and the one pure matcher
// that reads a binding.
//
// THE DECLARED SURFACE. This barrel is the contract: a name here is the layer's, a name
// only reachable through a deep path is not. That distinction is the repo's boundary rule
// (`docs/reference/api-posture.md` §R8) — importing a declared name through a file path is
// fine, importing an undeclared one is the violation.
//
// THE SECOND EXPORT-MAP ENTRY, and why there had to be one. `packages/editor/package.json`
// carried exactly one (`./field-host`), because the chrome was the only thing that ever
// needed to name a piece of the editor from outside its own tree. The daemon is the second:
// it runs on Node, it bundles from the CONSUMER's project root, and a bare-specifier entry
// is how it reaches this module without a relative path out of someone else's `src/`.
//
// THIS BARREL IS THE ZOD-FREE SURFACE. Everything named below is safe for the chrome to
// VALUE-import, and that is what makes the narrowed leakage rule work: the ban is on
// `action-registry/schemas` (and bare `zod`), not on the directory, so a barrel that
// value-re-exported the schemas would put zod back in reach of every chrome file that
// imports this file and no guard would see it. The schema TYPES are re-exported below
// because a type is erased; the schema VALUES are the daemon's and are reached at
// `./schemas.ts` directly, which is a declared sibling surface rather than a deep import of
// an undeclared name (api-posture §R8). It gains its own export-map entry the day the
// daemon needs one — T3b2 built the schemas, not the projection that reads them.
export {
  ACTION_DESCRIPTORS,
  type ActionDescriptor,
  type ActionGate,
  type ActionGroup,
  type ActionId,
} from "./descriptors.ts";
// `ShiftPolicy` is gone, not just unexported: the 2026-08-07 product decision (⇧ accepted
// on every NAME-matched key — ⇧⌫ deletes) retired the two-policy disagreement the field
// existed to preserve. The keys.ts header carries the history.
export {
  type KeyBinding,
  type KeyFacts,
  keycap,
  matchBinding,
} from "./keys.ts";
export {
  ACTION_OK,
  type ActionResult,
  failed,
  type RefusalClass,
  refused,
} from "./result.ts";
export type { ActionInputs, InputOf } from "./schemas.ts";
