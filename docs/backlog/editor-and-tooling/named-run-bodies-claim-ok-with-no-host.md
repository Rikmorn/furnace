# A named run that reaches the host through `ctx.host?.` answers `ok` with no engine

Foundations T4b Task 1 closed exactly this shape on the MEMBER funnel: a stamp member's arm
was `c.host?.startStamp(g.id)`, so with no engine up the pick did nothing and `runMember` still
answered `ACTION_OK` — a positive claim about an effect that never landed. The arm now returns
an `ActionResult` and refuses with `"inert"` when `ctx.host === null`.

**The named path has the same shape, one door over, and it was left standing.** The action
table reaches the host through an optional chain at **14 sites**. The grep is the durable
instrument and the line numbers are a snapshot taken when this entry was written —
`grep -n "ctx\.host?\." packages/editor/src/frontend/lib/actions.ts`:

`:679` `snapView` (shared by the six axis views) · `:780` `undo` · `:786` `redo` ·
`:798` `duplicateEntity` · `:835` `deleteEntity` · `:852` `beginMove` ·
`:864` `clearSelection` · `:872` `reselect` · `:928` `startStamp` · `:959` `confirmSession` ·
`:964` `rotateStamp` · `:971` `escape` · `:991` `frameSelection` · `:998` `frameWorld`

Thirteen are `handOff(…)` / `okAfter(…)` bodies, where the `{ ok: true }` the funnel returns IS
the claim about that call. The fourteenth (`:835`) is different in kind and is listed for
completeness: it sits inside `edit.delete`'s `onConfirm` callback, and its enclosing `okAfter`
honestly claims only *"the confirm was raised"* — the silent no-op there lands a human decision
later, so it is a variant of this shape rather than an instance of it.

## Context

**Reachability is NOT fully covered by `enabled`, and that is the part worth knowing.** Nine of
the fourteen are covered: their `enabled` predicates read ctx facts the host is the source of,
so with no engine the verb is disabled before its run is reached — `stats` (undo/redo),
`selectedEntity` (duplicate/delete/grab), `selection` (clear), `session`
(confirm/rotate), and `ctx.generators`, which stays `[]` until the host exists
(`frontend/hooks/useActionContext.tsx:132-137` fills it from `host.listGenerators()` in an
effect gated on `host !== null`).

**Five are `enabled: () => true` on purpose** and reach the host anyway — `snapView` `:679`
(shared by the six axis views), `edit.reselect` `:872`, `session.escape` `:971`,
`view.frame` `:991`, `view.frameWorld` `:998`. That is **ten** action ids, not five:
`axisView` is instantiated six times (`actions.ts:1000-1005`), so the one `snapView` site is
six of the ten. Each carries a comment saying why it stays live (a view verb needs no selection and no engine; Esc is never refused; the host reports
"nothing to frame" on its own channel), and every one of those arguments is about a host that
EXISTS and has nothing to do. The shell renders before the engine does, so pressing `F` pre-engine
runs `ctx.host?.frameSelection()` → `undefined` → `{ ok: true }`. Invisible to a human, who reads
it as "not ready yet"; a lie to a caller holding the Result.

## The candidate fix, and the decision inside it

A host-requiring sibling of `handOff`/`okAfter` — `(host: FieldHost) => void`, refusing when
`ctx.host === null` — so the precondition is stated once at the seam rather than 14 times, and
the optional chain disappears from the table. That is ~13 mechanical call-site rewrites plus
pins, which is why it did not land inline with T4b Task 1.

The real cost is not the rewrite, it is one decision the seam forces: **is "the engine is not up
yet" a refusal, or a legitimate hand-off?** T4b answered it for the stamp arm — `refused(…,
"inert")`, because opening a session is something the caller asked for and did not get. It is
less obvious for `session.escape`, whose whole stance is *never refused*, and for the frame
verbs, whose stance is *the host says "nothing to frame" itself*. A blanket answer would
overturn five deliberate `enabled: () => true` decisions; a per-verb answer needs the seam to
carry both shapes. Follow the member-arm precedent: the knowledge belongs where the effect is
written, not in the funnel.

## Trigger to revisit

**The first agent-facing caller that dispatches a NAMED action against a daemon whose chrome has
no engine up** — which is exactly the window an MCP client can hit that a human cannot narrate
away, since it has no canvas to watch and no "not ready yet" to infer. Sooner if any of the ten
`enabled: () => true` ids is put on an agent-reachable surface.

## Reference

- `packages/editor/src/frontend/lib/actions.ts` — `handOff` and `okAfter` (the seam), the 14
  sites above, and `ToolFamilyMember.arm`'s docblock, which carries the argument this fix should
  follow: why the host check belongs to the effect and not to the funnel.
- `packages/editor/src/action-registry/result.ts` — `RefusalClass`, and `inert`'s two-place rule.
- `packages/editor/src/frontend/hooks/useActionContext.tsx` — where `host` and `generators`
  become non-null, i.e. how wide the window actually is.
- `docs/reference/editor-architecture.md` §22.6 — the three provenances, and why a hand-off
  legitimately answers `ok`. The distinction this entry turns on: a hand-off to a host that
  EXISTS is honest; a hand-off to `undefined` is not.
