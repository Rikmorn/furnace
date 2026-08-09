// `@furnace/editor/action-registry` — the editor's verbs as DATA, and the one pure matcher
// that reads a binding.
//
// THE DECLARED SURFACE. This barrel is the contract: a name here is the layer's, a name
// only reachable through a deep path is not. That distinction is the repo's boundary rule
// (`docs/reference/api-posture.md` §R8) — importing a declared name through a file path is
// fine, importing an undeclared one is the violation.
//
// THE SECOND EXPORT-MAP ENTRY, AND ITS STATED REASON WAS WRONG — corrected in place at T4b
// Task 7 rather than left standing above its own refutation. `packages/editor/package.json`
// carried exactly one (`./field-host`) before this directory; `./action-registry` is the
// second, and it was added on the premise that THE DAEMON would need it — "it runs on Node,
// it bundles from the CONSUMER's project root, and a bare-specifier entry is how it reaches
// this module". T4b built the daemon-side reader that premise was about, and it is false:
// `daemon/mcp.ts` reads this directory not at all, the daemon's own source reaches in-package
// modules by RELATIVE path, and `grep -rn "@furnace/editor/action-registry" packages/` finds
// no importer anywhere — only this comment. The entry resolves and is pinned
// (`tests/action-registry/node-door.test.ts`); what it does not yet have is a consumer. The
// trigger that would give it one is the paragraph below, and it is not a daemon-side one.
//
// THIS BARREL IS THE ZOD-FREE SURFACE. Everything named below is safe for the chrome to
// VALUE-import, and that is what makes the narrowed leakage rule work: the ban is on
// `action-registry/schemas` (and bare `zod`), not on the directory, so a barrel that
// value-re-exported the schemas would put zod back in reach of every chrome file that
// imports this file and no guard would see it. The schema TYPES are re-exported below
// because a type is erased; the schema VALUES are the daemon's and are reached at
// `./schemas.ts` directly, which is a declared sibling surface rather than a deep import of
// an undeclared name (api-posture §R8). This line used to promise it "gains its own
// export-map entry the day the daemon needs one"; T4b weighed that day and it has not come.
// The daemon's MCP door landed (`daemon/mcp.ts`) reading this directory not at all, and the
// promise was aimed slightly wrong besides: an `exports` entry is the CONSUMER-ROOT door
// (`daemon/bundle.ts:37-42` resolves its generated entry from someone else's project, which
// is what the two entries above are for), while the daemon's own source reaches in-package
// modules relatively. So the trigger is an outside-the-package consumer, not a daemon-side
// one — the same verdict `shared/tool-registry.ts:33-35` reached for the floor.
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
