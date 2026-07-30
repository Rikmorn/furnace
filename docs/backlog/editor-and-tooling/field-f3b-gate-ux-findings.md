# Field F3b gate — UX findings (deferred as a set)

> **F4.5a update (2026-07-30).** The **shell portion of this set has landed** — the
> overlay cockpit rebuilt the chrome these findings were filed against: one full-window
> canvas that nothing reflows, floating palettes, a single burger menu with a complete
> shortcut overlay, toasts + a durable message log in place of the panel status line, a
> world drawer with confirms on every destructive verb, and studio shading by default
> (`docs/reference/editor-architecture.md` §20). **The specifics below are still owed**
> and are still stage input: anything about a control's affordance, wording, feedback or
> gesture survived the rebuild unless it named a surface that no longer exists. This
> file is consumed at the F4.5 seal, not before — do not delete it.

Findings from the F3b Safari gate round 1 (2026-07-25) that are interaction-model
work, not mechanism bugs. The two mechanism bugs found the same round were fixed
in-slice (`4aa4690e` scatter sample-aligned crossings; `10551f9e` destructive-tone
status line). Siblings: `field-f3a-gate-ux-findings.md`,
`field-f2b-gate-ux-findings.md`, `editor-interaction-model-redesign.md` — this set
joins them as **F4 recharter** ("seeing & the cockpit pass") input.

## 1. Tool arming is invisible

With brush effects, the `segment` gesture, and a pending stamp session all live at
once, nothing in the viewport says which click does what ("dig + segment + cave —
hard to know which one is actually selected"). The ToolPalette buttons carry
pressed states, but the cursor/viewport itself gives no affordance. Wants: a
cursor/HUD statement of the armed tool, likely alongside the F4 pointer tool.

## 2. The stamp-session dual-operation model reads as "2 operations at once"

While a stamp session (cave) pends in the inspector, viewport clicks still drive
the ACTIVE BRUSH — the user dug a large tunnel while believing they were
interacting with the cave stamp, then Enter committed the cave entity separately:
"why do we do 2 operations at the same time". This is the F2b-era model (stamps
are inspector-driven; the viewport stays a brush surface). Options for F4: arming
a stamp suspends the brush; or stamps become viewport-placed via the pointer tool.

## 3. Region-first flow is undiscoverable

Stamps (scatter especially) require an active box selection to seed their region.
The refusal now renders loudly ("select a region first", destructive tone), but
the FLOW is still discovery-by-refusal — the user reached for scatter first and
box select never suggested itself. F4: the stamp button could enter a
"draw the region" mode directly instead of refusing.

## 4. Placement ghost vs committed props — perception check pending

Preview records and committed records are BYTE-IDENTICAL (parity-proven,
`scatter-parity` probe + the F3b suite), and the ghost wireframes use the same
proxy sizing + orientation as the committed proxies (`proxyCorners` →
`proxyScale`). The round-1 "preview doesn't match result" report predates the
scatter starvation fix (3 records on a whole cave) and may have been it. If the
perception persists in round 2, capture WHAT differs (position / size / count /
shape) — the remaining candidates are wireframe-vs-solid reading and the
catalog-fallback sizing on an uncatalogued archetype.

## 5. Void-cast round-2 watch items

Round 1: "can't do anything with it" — refusals were invisible (fixed). Watch in
round 2: (a) if the world exceeds the 512-chunk budget the refusal now SAYS so —
decide then whether the budget rises or the cast scopes to the selection; (b) the
X-ray is designed for OUTSIDE-looking-in viewing (`compare: "always"` dominance);
from inside the carved space expect a much weaker read — if inside-view matters,
that is a render-design item, not a toggle bug.

**Trigger to revisit:** the F4 recharter brainstorm (this set rides in with the
f3a/f2b sets + interaction-model-redesign).

**Reference:** `docs/reference/editor-architecture.md` §18; the F3b gate round-1
fix commits named above.
