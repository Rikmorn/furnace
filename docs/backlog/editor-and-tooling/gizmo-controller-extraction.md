---
summary: written against a deleted scene-editing host — none of the six symbols it names still exists, the field host's gizmo MATH is already an extracted module, and what is left in the closure is wiring rather than a controller, so this wants re-scoping or retiring
---

# Extract translate-gizmo controller from the field host

*(Fenced out of the M5B editor milestone, 2026-06-14 — the milestone that delivered the viewport manipulation loop on top of M5A: GPU-id picking, AABB highlight, translate gizmo, orbit camera, drag-scrub and the focused-input echo-guard.)*

**STALE PATH, corrected 2026-08-06.** This entry was written against
`src/viewport-host/index.ts`, the M5B scene-editing host — a file that no longer exists. The
directory rename (foundations T3b1) re-pointed the path to `src/field-host/index.ts`, which is
a 57-line barrel and holds none of what is described below. Whatever survives of this want
lived in `src/field-host/field-host.ts` when this note was written — since T3c+T3d it is
spread across that file's extracted sibling modules (the gizmo's state and wiring are now
`field-entities.ts`'s, its drawing `field-render.ts`'s, its axis pick `field-picking.ts`'s);
the named symbols should be re-verified against those before the entry is acted on.

**Context (as written at M5B):** `viewport-host/index.ts` grew to ~685 lines after M5B. The file is cohesive
(all host wiring), but it is past the ~400-line cognitive-load guideline
(`.claude/rules/clean-code.md`). The gizmo controller — `tryStartGizmoDrag`,
`updateGizmoDrag`, `commitGizmoDrag`, `cancelGizmoDrag`, `committedTransform`,
`currentTransform`, `gizmoDrag` state, and `renderGizmo` (~110 lines) — is the cleanest
extraction candidate: pure drag-state management that could live in a `gizmo-controller.ts`
alongside `gizmo.ts`.

**Trigger to revisit:** Next substantial host change (e.g. rotate/scale gizmo work in a future editor-redesign pass) or a
dedicated cleanup tranche. Not urgent — the file is cohesive; the smell is size alone.

> **The size half is being paid down by the foundations T3 tranches; the named symbols are
> gone (checked at source, 2026-08-07).** `field-host.ts` was **6,337 lines / 2,854 code** at
> foundations T3c, down from 7,410 at the original cluster-map pass — T3c alone took −929
> (−12.8%), the largest single bite, by lifting the session/gesture machine and the pointer
> chain into `field-host/field-machine.ts`. At T3d it is **3,999 / 915** (checked at source,
> 2026-08-08): the remaining clusters left for sibling modules and the file is now the facade.
>
> **None of the six symbols this entry names still exists anywhere in the repo**
> (`tryStartGizmoDrag`, `updateGizmoDrag`, `commitGizmoDrag`, `cancelGizmoDrag`, `renderGizmo`,
> `gizmoDrag`) — they belonged to the deleted scene-editing host, which is what the STALE PATH
> note above warned about. Grepped, not assumed. The field host has a translate gizmo of its
> own (D-9) whose pure math is ALREADY an extracted sibling module,
> `packages/editor/src/field-host/gizmo.ts` (`gizmoSpan`, `pickAxis`, `axisLines`,
> `closestPointParamOnAxis`); what is still in the closure is the state and the wiring —
> `gizmo`, `gizmoBatch`, `gizmoAxisAt`, `gizmoVisible`, and the rebuild that hangs them on the
> selection box. **So this sub-item is not the extraction it was written as.** Anyone acting on
> it should re-scope it against the as-built first, or retire it: the thing it proposed to
> create largely exists, and the residue is wiring rather than a controller.

**Reference:** M5B Task 13 holistic review. The M5A/M5B as-built sections were deleted from the editor as-built when the surface was (F4.5a chrome, T2 daemon + core) and git history is the record; what stands today is `docs/reference/editor/inspector.md` (the inspector module, which survived intact) and `docs/reference/editor/chrome.md` with its siblings (the overlay cockpit that replaced the rest). SOTA research on picking and gizmo math: `docs/research/2026-06-11-editor-m5-inspector-sota.md`.
