# Biome does not lint `.tsx` — editor React source is unchecked

**Context.** `biome.json`'s `files.includes` lists `**/*.ts`, `**/*.json`,
`**/*.html`, `**/*.css`, `package.json` — but NOT `**/*.tsx`. Verified
empirically (a probe `.tsx` with an unused var is reported "provided but
ignored"; a full-repo `biome check` reports 645 files / 57 warnings, all in
`.ts`, zero `.tsx`). This means `bun run check` has NEVER linted any editor
React source (`src/frontend/**/*.tsx`). Type correctness is still gated by
`tsc --noEmit` and behavior by `bun test`; only Biome's style/complexity/format
rules are absent on `.tsx`. Pre-existing — `.tsx` has never been in `includes`
since the initial commit (confirmed via git history); Slice 3.2.2 just made the
gap more visible by adding the 11 generated shadcn `components/ui/*.tsx` plus
new chrome components.

**Complication to resolve when picking this up:** enabling `**/*.tsx` will lint
the vendored/canonical shadcn `components/ui/*` too. Those are copied upstream
source (regenerable by `shadcn add`) and shouldn't be hand-diverged to satisfy
lint. So the fix isn't just "add the glob" — it needs a decision on the `ui/`
dir: either exclude `src/frontend/components/ui/**` as vendored code, or confirm
canonical shadcn passes the repo's ruleset clean. Also expect a one-time
organize-imports pass on the existing `.tsx` (the Slice 3.2.2 swap left a few
`ui/` imports out of Biome's sort order, harmless only because `.tsx` is
unlinted).

**Trigger to revisit:** any editor tranche that wants CI-enforced `.tsx` lint, or
the next time a `.tsx` style regression slips through review. Not urgent — the
acceptance gates (tsc, tests, `/impeccable`, user Safari gate) don't depend on it.

**Reference:** `packages/editor/biome.json` (`files.includes`); surfaced in the
Slice 3.2.2 Task 4 (shadcn control swap) code-quality review.
