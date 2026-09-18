# sk-* Guidance Authoring

How to write and change a project's standing guidance — CLAUDE.md, `.claude/rules/`, skills, and commands. For human contributors and agents alike. Calibrated for capable frontier models, which means trusting reasoning by default and constraining it only where reasoning cannot get there. Recalibrate as models change.

## Admission: what earns a place

Guidance exists to do what reasoning alone cannot. Three things qualify:

- **A ruled convention** — a house preference where both sides are defensible (comment style, when to narrow a type). Reasoning can't converge on these because there is no fact of the matter, and an unwritten preference can't win a review. One ruling by the owner admits it.
- **A mechanism fact** — an environmental truth the model can't derive: a formatter whose `--check` flag still rewrites files, a service that only exists behind a local dev proxy, the status code a missing record returns. State the mechanism, not just the instruction — a mechanism feeds reasoning; a bare instruction replaces it.
- **A demonstrated failure pattern** — a lesson from work, admitted at three or four independent data points. One incident is an anecdote: record it on the issue tracker or in session memory and let it earn admission.

Before deriving guidance from a codebase's precedent, check whether that precedent is a known accepted tradeoff. Something recorded as "aware, not ideal" is never an exemplar — cite it as one and the shortcut becomes the standard.

## Form: principle over procedure

- State the failure mode and why, in a sentence or two. Steps encode a workflow, and workflows break on any input that doesn't fit; a principle transfers.
- The constraint test decides firmness: if there is a reasonable scenario where the reader should deviate, write "prefer X because…", not "always X". Reserve firm directives for safety boundaries and facts that are never wrong.
- Don't add worked examples per incident. Examples teach surface forms; a second round of examples for the same rule is the signal that the lever is wrong.
- Volatile counts stay out (`sk-working-standards.md` §Numbers that go stale).

## Placement: rules are the last resort

Writing a lesson down does not transfer it to generation — checks fire in the review chain, not from codified prose. Cheapest home first:

1. **Enforcement** — a check that must actually fire becomes a hook, or a line in the prompt that reviews the work. A hook denying edits to generated output is the pattern.
2. **Memory or session context** — process notes for a specific working mode.
3. **The issue tracker** — known gaps and accepted tradeoffs, filed where work items live (`sk-pm-conventions.md`).
4. **A rules file** — only the three admissible categories, in the most specific file covering the topic. CLAUDE.md carries only what every session needs; path-scoped rules load only when their files are touched.

Guidance accumulates by default: every incident proposes a rule, and nothing proposes deletions. When editing a file, apply these tests to neighbouring entries too, and delete what no longer earns its place.
