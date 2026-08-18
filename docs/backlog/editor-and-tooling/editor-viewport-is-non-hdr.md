---
summary: the editor viewport requests a non-HDR context and renders `effects: []`, so it is a deliberately different look from the game's bloom/tonemap/fog — going HDR requires supplying a final tonemap pass, survives a host dispose/init round trip, and must not break capture's load-bearing `sampleCount: 1`
---

# The editor viewport is non-HDR and draws no post chain

> **Re-anchored 2026-08-05 (foundations T2).** This entry was written against the SCENE-editing
> viewport host (`field-host/index.ts` `renderLoaded`, which passed `effects: []` and could
> not render a scene document's authored post chain). That host, the Slice 3.1 preview host
> beside it, and the scene format's `effects` table are all deleted. **The gap itself is
> unchanged and now belongs to the field host**, which is the editor's only viewport — so the
> entry is restated rather than closed. The old parenthetical about `scene.setResource`'s
> `tableEnum` not covering `textures`/`effects` is dropped outright: that command no longer
> exists.

`createFieldHost` requests a **non-HDR** context — `requestContext(canvas, { sampleCount: 1 })`
since foundations T4c (it was `sampleCount: 4` when this entry was written; MSAA left the
editor, and the single-sample count is now a REQUIREMENT rather than a default, because
`frame.renderToTexture` refuses anything else and the capture path needs it), taking `hdr`'s
`false` default (that half is still `field-host.ts`'s `init`) — and the
`frame.render` call passes **`effects: []`**
(`packages/editor/src/field-host/field-render.ts`, since T3d). So the editor viewport shows lights +
ambient + studio/normals shading and nothing else: no bloom, no tonemap, no fog-through-post.

The game does not look like that. `packages/dungeon/src/main.ts` requests
`{ sampleCount: 4, hdr: true }` and renders through `bloom → tonemap` with exponential fog.
**The editor is therefore a deliberately different look from the thing being authored** — which
is fine for sculpting geometry (arguably better: an unfiltered view of the surface) and wrong
for judging mood, emissive materials, or anything a bloom threshold decides.

**New cost on the `hdr: true` path, added by foundations T4c.** `frame.drawLinesToTexture`
(the off-screen line overlay the capture path composites gizmos and markers with) refuses HDR
contexts outright: the line pipelines write `ctx.format` while `renderToTexture` writes
`workingColorFormat`, and on HDR those differ, so no one texture can hold both the meshes and
their overlays. Whoever promotes this entry must therefore also decide what capture does —
either the line pipelines gain a `workingColorFormat` target variant, or off-screen captures
lose their overlays. Not a blocker; a bill that is now visible before the work starts.

The `frame.render` HDR↔effects contract is (verified in `packages/core/src/frame/render.ts`) that
it throws **only on the inverse** — `hdr === true` **and** an empty effect chain (an
`rgba16float` scene target with no pass to reach the LDR swap chain). A non-HDR context with
effects does not throw. So an HDR editor viewport is not a one-line change: going `hdr: true`
REQUIRES supplying at least a final tonemap pass, and switching context flags disposes and
re-inits the host, so the field, op log, tool and camera have to survive that round trip.

**The precedent for the round trip is now a capability rather than a caller.** The AA switch
was the live example of a context property driven from the chrome, and T4c deleted it; what
remains is `FieldHost.dispose()` + `init()`, still contractual, still walked on a real device
by `tests/field-host-reinit.gpu.test.ts`, plus `CanvasHost`'s teardown chain, which is kept
and labelled as insurance. Whoever builds this rebuilds the CALLER — the mechanism is there.
**And it will collide with a newer constraint:** the editor's `sampleCount: 1` is load-bearing
for capture, so an HDR preview mode must not reach for `{ sampleCount: 4, hdr: true }` the way
`packages/dungeon/src/main.ts` does.

**Trigger to revisit:** a gate finding about the editor's look diverging from the game's
(mood, emissives, fog), OR any work that gives the editor a "preview as the game sees it" mode.

**Reference:** `packages/editor/src/field-host/field-host.ts` (the `requestContext` call and
the `effects: []` render), `packages/dungeon/src/main.ts` (what the game actually requests),
`packages/core/src/frame/render.ts` (the HDR↔effects throw contract),
`docs/reference/editor-architecture.md` §16.1 (what `init` asks for and the teardown chain
that would order a re-init), `studio-key-light-blows-out-near-geometry.md` (the other
deferral on this same render path — a tuning note whose subject changes if this one lands).
