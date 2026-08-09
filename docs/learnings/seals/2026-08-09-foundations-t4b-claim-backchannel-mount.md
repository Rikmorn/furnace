# Foundations T4b — claim, backchannel, mount

- **Sealed:** 2026-08-09 — the middle tranche of foundations T4: the agent door opens,
  reads only.
- **Package(s):** editor (+ `@modelcontextprotocol/sdk@1.30.0`, the tranche's one new
  dependency). 9 commits `0e89327d..df202056` FF-merged to master; 81 files,
  +9057/−269 (includes the review session's docs commit).
- **Gate:** standing review (all seven exit clauses re-derived; both sabotages
  reproduced by name; docs audited line-by-line — no doc-vs-code contradiction
  survived) **+ clause 5 WALKED LIVE at the review**: real SDK client against the
  running daemon — 3 tools listed, instructions at 2020 bytes, `session_state` through
  the claimed Safari tab in 16 ms matching the human's screen, two concurrent guests
  independent, no-session/tab-closed refusals typed in 3–4 ms. Never a hang, measured.
  (The holistic user VISUAL gate stays deferred to T4 close, unchanged.)
- **Suite:** 2951 → **3057 pass / 1 skip / 0 fail** (+106; wall clock ~54 s — the SDK
  3× hazard contained via the spawn-child probe).

**The tranche.** The daemon learns who is authoring: a claim that lives and dies with
the SSE socket (`claims.ts` — connection-scoped ephemera, identity-conditional release
pinned against the reload race, steal + claim-lost cover, nothing survives restart).
The daemon asks the claimed tab a question: `backchannel.ts` — one take-helper every
exit funnels through (delete → clear → settle), correlation ids that cannot cross,
10 s budget argued against the client's 60 s first-byte floor (confirmed with
mechanism: raisable, never lowerable). The session says what it holds:
`session.state` off the chrome's latched mirrors with a cursor that rides the history
seam's PUBLISHED payload and admits exactly what it certifies. The agent door opens:
`/mcp` first on the ladder, per-POST Server + stateless transport (SDK 1.30 cannot
reuse one — measured, no diagnostic on either side), three TEXT-first read tools,
`AGENT_REMEDY` exhaustive over all ten error codes, instructions ≤2KB pinned by byte
count. Error codes 8→10: `no-session` 409 (argued against the hides-existence
precedent), `session-timeout` 504 (RFC 9110 — the backchannel is where the daemon
acquires an upstream). `runMember` refuses unknown members, arms report honestly, and
every refusal carries a seven-member `because`.

**The pre-existing bug the tranche found and fixed:** Bun 1.3.14 never fires
`res.on("close")` — the SSE subscriber cleanup, the daemon's only liveness signal, had
been a silent no-op in the live editor since the daemon's first commit (heartbeat
writing to dead responses forever). Both events now watched, latched, pinned per
runtime. Also found at the review the same class one layer up: a `GET //` process-kill
had been fixed at T4a; T4b's spike proved the `headersSent` double-throw would be the
same fatal kill and kept the guard.

**Rulings at the review (user, 2026-08-09):** the four plan deviations RATIFIED
("nothing was lost, just replaced") — concurrent `allSettled` close · camera poll (a
standing one-subscriber pin forbade the second) · cursor recomposed on the existing
`worldEpoch/ops.length/undoLen/redoLen/nextId` spelling (the plan's could not
serialize; the reviewer disproved a "redundant term" claim with a counterexample — now
pinned load-bearing) · `SessionAnswer` as a discriminated union (a silent chrome must
refuse fast, not time out). The DECLINED export-map entry RATIFIED (the plan's stated
reason was false — nothing in the daemon imports action-registry; the 90-pair
advertisement-equals-validation pin landed regardless). The claim-key seam
(`re-claim-on-world-switch`, filed at review closing a dangling citation) → **T4c
early task**. **MSAA REMOVED from the editor — user ruling at the gate walk** ("it's
pointless" — dissolves T4c's largest capture blocker; engine keeps MSAA; editor-only;
T4c early task; cost stated: overlay lines alias slightly at sample count 1).

**The gate's own finding, filed:** `SessionState.tool` reads as "dig armed" while the
human sees Select — truthful (`gesture: "pointer"` is the arming fact; `tool` is
dormant brush config) but illegible: the reviewing agent misread it live, exactly as a
T4c agent would (`session-state-armedness-is-two-fields.md`).

**Process lessons.** The restack class recurred and escalated: the execution report
described Task 5's close ordering with an argument the final code's own docblock
refutes, and claimed the docs commit held no source — both false after amends; the
seal and reviewer worked from the ARTIFACT, and the report now carries dated
corrections. The executor's own §9 warning held: the branch was corrected four times
for docblock REASONS going stale while counts stayed right — watch reasons, not
numbers, in T4c. The whole-branch review earned its place: it found the claim-key seam
composition and a self-contradicting file that per-commit review structurally cannot
see. AGENTS.md untouched. NEXT: T4c — mutation verbs, capture, lint, presence, THE
GATE (plan written at this review from the persisted digest
`report/2026-08-09-t4c-planning-inputs.md`).
