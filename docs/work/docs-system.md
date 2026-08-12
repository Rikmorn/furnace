---
status: in-flight
injected: true
summary: docs-system rungs 1–4 — integrity checks, authoring contracts, the work register, the promotion gate
---

# Docs system (rungs 1–4)

Chartered by `docs/backlog/infrastructure/docs-registers-findability.md`, which asked how a
growing body of deferred-work markdown stays findable and showed that a file-count
threshold is the wrong instrument.

**What it lands:** prevention (an always-in-context authoring rules file), canon
(`docs/reference/docs-system.md`), detection (`scripts/check-docs.ts`, in `bun run check`),
contracts (frontmatter + a generated backlog index), this register itself, and the seal
promotion gate.

**Rung 5 is deliberately NOT in this slice** — tracker un-merge, the
`editor-architecture.md` split, and the AGENTS.md trim. It gets its own plan against the
post-rung-4 as-built, protected by the checks this slice lands. That ordering is the whole
safety argument: checks before the motion they protect.

**Injected** ahead of the cockpit epic's remaining slice. The injection is priced here
rather than absorbed silently — which is itself one of the problems this slice exists to
fix.
