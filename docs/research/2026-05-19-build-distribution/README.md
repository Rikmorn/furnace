# Build & distribution surveys — 2026-05-19

Three surveys run the same day, all deliberately survey-not-recommendation: they map the
range of shapes other ecosystems use to ship a CLI and a native runtime, so furnace's own
choice could be made against a real spread rather than one remembered example.

- [cli-libraries.md](cli-libraries.md) — six Node CLI libraries, tradeoffs surfaced, no winner picked.
- [native-shell-distribution.md](native-shell-distribution.md) — how six ecosystems get a native runtime onto a consumer's machine, where consumer customisation lives, what adding a platform costs.
- [per-platform-builds.md](per-platform-builds.md) — seven multi-platform build tools, and where each puts per-platform code.

**Fed:** the native-shell and per-platform-binary posture in `docs/reference/packaging-and-distribution.md` §6 (native shell distribution) and its deferred biome-pattern CLI distribution — recorded there without citing this directory; the co-citation in `docs/backlog/native-runtime/mac-app-code-signing-and-notarization.md`, which names `packaging-and-distribution.md` §6 and `native-shell-distribution.md` together, is the surviving join. `cli-libraries.md` picked no winner and fed no decision.
