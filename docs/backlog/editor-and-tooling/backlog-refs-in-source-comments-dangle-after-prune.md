# One source comment still names a deleted backlog entry — and it lives in `packages/core`

**The sweep this entry was filed for RAN at the F4.5 seal (2026-08-03) and closed every site
but one.** Retargeted in that pass: `frontend/lib/catalog.ts` and
`viewport-host/field-placements.ts` (both `field-editor-prop-meshes.md` →
`field-tool-follow-ons.md` § *Editor props render as collision PROXIES…*),
`viewport-host/field-host.ts` (`field-reconfigure-ghost-exactness.md` → the same file's
§ *Reconfigure ghost previews against CURRENT field state…*),
`tests/field-host-headless.test.ts` (`field-host-worker-injection-seam` →
`editor-test-harness-fragility.md`), and `docs/reference/ui-foundation.md` +
`editor-backend-architecture.md` (both `svelte-editor-inspector-surfaces.md`, which never
existed on master). The seal's own deletions — the five gate-UX sets, the
interaction-model master entry and the charter-inputs file — were swept in the same pass,
across five source files and six docs.

**What is left, and why:**

| site | dangling name | now lives in |
| ---- | ------------- | ------------ |
| `packages/core/src/field/generators.ts:216` | `enum-field-stringifies-numeric-members.md` | `editor-chrome-authoring-gaps.md` § *EnumField stringifies enum members and never coerces back — numeric enums are dead on arrival* |

It was NOT fixed at the seal because the F4.5c slice carried a hard **`packages/core` is
byte-untouched** invariant, and the merge gate for the a+b+c stack is
`git diff 68a66110 -- packages/core` being empty. A one-line comment retarget would have
broken a mechanical gate for a cosmetic gain, in the last commit before a three-branch merge.
That is this entry's original condition failing again — "in a file you are already touching" —
with one row instead of five.

**Trigger to revisit:** the next session that edits `packages/core/src/field/generators.ts`
for any reason. It is one line and needs no decision.

**Reference:** AGENTS.md § "Keeping docs current" (the *"Renamed a file… grep for the old path
before committing"* rule this entry exists to satisfy). The grep that catches a regression:
`grep -rn "docs/backlog/editor-and-tooling/" packages --include="*.ts" --include="*.tsx"`,
then check each named file still exists — nothing tests a path inside a comment.
