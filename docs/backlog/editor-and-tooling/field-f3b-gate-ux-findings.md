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
>
> **F4.5b update (2026-08-01).** Item 1 is resolved (Tasks 8 and 9) and joins items 2
> and 3, which F4.5b Task 9 had already resolved. Items 4 and 5 STAND, and were checked
> against source rather than assumed: nothing in F4.5b touched the ghost-vs-committed
> proxy sizing (`field-placements.proxyCorners` / `proxyScale`), and the void cast's
> `VOID_CAST_CHUNK_BUDGET = 512` refusal and `compare: "always"` X-ray dominance are
> unchanged. Both are gate observations that only a gate can close.

Findings from the F3b Safari gate round 1 (2026-07-25) that are interaction-model
work, not mechanism bugs. The two mechanism bugs found the same round were fixed
in-slice (`4aa4690e` scatter sample-aligned crossings; `10551f9e` destructive-tone
status line). Siblings: `field-f3a-gate-ux-findings.md`,
`field-f2b-gate-ux-findings.md`, `editor-interaction-model-redesign.md` — this set
joins them as **F4 recharter** ("seeing & the cockpit pass") input.

## 1. ~~Tool arming is invisible~~

**RESOLVED in F4.5b Tasks 8 and 9 (2026-08-01, D-F4.5-6/7/8)** — with four channels
rather than the one this item asked for, and the module that owns two of them says so in
its own header (`viewport-host/viewport-cursor.ts`):

- the **rail** presses the armed family (`aria-pressed` per row, `shell/ToolRail.tsx`);
- the **top strip** names the armed effect and shows only ITS params
  (`shell/ToolStrip.tsx` over `shell/tool-params.tsx`);
- the **status keymap** says what LMB does right now, per armed state — `armedKeymap` in
  `shell/StatusBar.tsx` has a line for the brush (naming the effect and its live
  modifiers), one for each gesture, one for a pending stamp (naming the generator) and
  one for a live session;
- the **cursor** answers under the pointer: `viewportCursor` picks the CSS keyword
  (`crosshair` commits at a point, `cell` spans between two, `default` selects or is
  suspended, `grab`/`grabbing` during a move) and `cursorAffordance` decides the
  world-space mark drawn before the first click (a radius ring for the segment, an anchor
  cross for the box and the pending stamp's region).

The exact case the item names — brush plus segment plus a pending cave at once — is also
answered mechanically rather than only visually: a live session SUSPENDS both
field-writing arms (`suspendedByStamp`, see item 2), and the cursor drops to `default`
for them so it stops promising a click the host is going to swallow.

*Original finding.* With brush effects, the `segment` gesture, and a pending stamp
session all live at once, nothing in the viewport says which click does what ("dig +
segment + cave — hard to know which one is actually selected"). The ToolPalette buttons
carry pressed states, but the cursor/viewport itself gives no affordance. Wants: a
cursor/HUD statement of the armed tool, likely alongside the F4 pointer tool.

## 2. ~~The stamp-session dual-operation model reads as "2 operations at once"~~

**RESOLVED in F4.5b Task 9 (2026-07-31)** — the FIRST option, and it took two rounds:
the first pass suspended only the SPHERE brush, and review found the segment brush
still sweeping a capsule straight through a live session — which is this finding
verbatim, since "the large tunnel the user dug" IS a capsule sweep. Both field-writing
arms are now swallowed at `onPointerDown` (`suspendedByStamp`, reached from the stroke
branch AND the gesture branch), the swallow REPORTS once per session rather than
failing silently at the one moment the user is asking, the brush ghost and the canvas
cursor are both suppressed, and the key that re-arms the brush polarity (`X`) joined
the `armsTool` set so it refuses with the same sentence the family keys give. Selection
gestures deliberately stay live — they write nothing to the store. The session strip's
clause says the brush rather than arming, because both are now true.

*Original finding.* While a stamp session (cave) pends in the inspector, viewport
clicks still drive the ACTIVE BRUSH — the user dug a large tunnel while believing they
were interacting with the cave stamp, then Enter committed the cave entity separately:
"why do we do 2 operations at the same time".

## 3. ~~Region-first flow is undiscoverable~~

**RESOLVED in F4.5b Task 9 (2026-07-31)** — exactly the suggested shape (D-7): picking
a stamp with nothing selected ARMS region-draw instead of refusing, the next two clicks
span its region, and that region opens the session. The refusal string is gone. The arm
is published on `subscribePendingStamp`, so the rail presses the stamp family, the
status keymap reads `drag a region for <name> · Esc cancels` and the cursor turns to a
crosshair — the selection-first flow still works unchanged for a user who had a
selection already.

*Original finding.* Stamps (scatter especially) required an active box selection to
seed their region; the refusal rendered loudly but the FLOW was still
discovery-by-refusal — the user reached for scatter first and box select never
suggested itself.

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
