# Foundations T4a — the honest substrate

- **Sealed:** 2026-08-09 — the first tranche of foundations T4 (MCP), deliberately
  containing zero MCP work: it makes the ground honest before any agent connects.
- **Package(s):** editor + core (field), 6 commits `f6f32e89..587ea60d`, FF-merged to
  master at `587ea60d`; 51 files, +3940/−639.
- **Gate:** standing review — independent reviewer re-ran all gates, both load-bearing
  sabotages (palette bypass invisible except to the source scan; `confirmOpen`
  hard-code → exactly 4 reds), the docs audit, and every headline number. **User visual
  gate DEFERRED by ruling (2026-08-09) to one holistic check at T4 close** — nothing
  human-visible changed this tranche; do not mistake this seal for a passed walk.
- **Suite:** 2912 → **2951 pass / 1 skip / 0 fail** (+39, all additive; zero flake
  reruns needed).

**The tranche.** Member picks funnel through `runMember` — `member.arm` has exactly one
caller, held by a source scan that cannot pass vacuously. The gate stops lying: refusals
are `{ok:false; hint: string; spoken}` with non-nullable reason (the label fallback is
REMOVED, not dormant), and `namedDispatch(ctx)` computes `confirmOpen` from
`ctx.isConfirmOpen()` — the modal-refusal path is now reachable and pinned. All three
brush shapes validate numerically behind an exhaustiveness guard, on BOTH decode paths;
`parseOps` checks every numeric interior at what is now a security boundary (plus
`assertClassId`, plus selection region bounds — where the measured hazard was inverted:
a non-finite bound selects EVERYTHING, 512/512, an unbounded write). All three group
commit paths validate the whole list before the first write, with locators naming the
bad op. The daemon refuses non-loopback Origins (26-row table, five route branches,
probed over raw sockets) — and the sweep found a PRE-EXISTING remote process-kill
(`new URL` outside the try; `GET //` terminates the daemon under Node 22, the shim's
governing runtime) and fixed it: `requestUrl` inside the try, 400 after the 403, pinned
over a raw socket because `fetch` normalizes the hostile targets away.

**Rulings at the review (user, 2026-08-09):** exit clause 3 sealed **PARTIAL, accepted**
— dispatch callers get computed truth; the display seam keeps `NAMED_RENDER`
(`confirmOpen: false`) by the executor's ruling that display projection stays
modal-blind (display asks "how should this render", enforcement asks "may this
proceed"; restores `controlVerdict` to memoizable ctx facts; asymmetry pinned both
directions, one-caller scan machine-held). Backlog disposition **2 deleted + 2 narrowed
ratified** — a stated deviation from the plan's letter ("four delete, one may narrow"):
parseOps kept two live questions (table-dependent class-id resolution; file-locator
messages), group-apply narrowed to the pass-2 rollback residue with a sabotage-verified
tripwire. `runMember`'s unvalidated family/member pairing → **T4b early task**, before
any agent surface calls it.

**Premise deltas, the material one first:** Task 5's answer already existed —
`logApplyGroup` and `commitGenerator` both already validated-all-then-applied, TSDoc
saying so; the task was reframed at execution to verify → close the real gap (locators)
→ dispose honestly. The plan's "three silent gate classes" were FOUR (the menu-only
backstop). JSON has no NaN/Infinity literal (`stringify` writes null; only
`1e999`-class exponents parse non-finite) — falsified a test-table design mid-task.
~18 further source-fact corrections are recorded in the execution report §6.

**Backlog:** 2 deleted · 2 narrowed (retitled to their residues) · 3 filed
(`field-artifact-four-codecs-one-file`, `locator-rethrow-primitive-respelled-six-ways`,
`reconfigure-empty-evaluation-leg-unheld`) · 6 modified (citation re-anchoring, struck
triggers). Nine T4b inputs surfaced and carried to the T4b plan, not acted on.

**Process lessons.** Both T3-close protocol clauses fired usefully: walking the plan's
named small items surfaced Task 5's pre-existing answer and the fourth silent class;
computing numbers from artifacts caught five hand-typed figures (including one in the
execution report's own protocol section — corrected at review, 6 not 9). **New standing
clause adopted: the citation sweep** — stale `file:line` citations were found five
separate times, always in files the tranche itself had grown; every task after the
second carried an explicit sweep instruction and every sweep found something. AGENTS.md
untouched. NEXT: T4b — session claim + backchannel + MCP mount + the read surface (plan
written at this review from the fresh digest).
