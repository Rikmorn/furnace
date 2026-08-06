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
export {
  ACTION_DESCRIPTORS,
  type ActionDescriptor,
  type ActionGate,
  type ActionGroup,
} from "./descriptors.ts";
// `ShiftPolicy` is deliberately NOT here. It has no consumer outside `keys.ts`, it is
// reachable through `KeyBinding` for anyone who needs to name it, and re-exporting a type is
// one line on the day a consumer actually appears. Publicness is a decision someone made.
export {
  type KeyBinding,
  type KeyFacts,
  keycap,
  matchBinding,
} from "./keys.ts";
