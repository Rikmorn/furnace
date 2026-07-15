# One Field · F1 "The Medium" — build-complete handoff (2026-07-15)

**Status: BUILD COMPLETE, LOCAL/unpushed on branch `one-field-f0-f1`. NOT sealed — the
Safari manual gate and the merge are the user's.** This is a handoff, not a seal: no
`AGENTS.md`/README/reference-architecture doc was touched (those update at seal, after the
gate passes). F0's probe report is the sibling: `docs/learnings/2026-07-15-analyzer-corpus-probe.md`.

## What F1 delivered

One vertical slice of the One Field model: a chunked voxel-density field in `@furnace/core/field`,
a dig brush in a new editor **Field** panel, background remeshing in a dedicated worker, a v2
field-world artifact, and the dungeon walking the bake. **The loop is real and headlessly proven:
dig → bake → the dungeon loads the v2 world and walks through the dug tunnel** (`field-world.gpu.test.ts`,
`advanced = 5.05` past a `> 4.5` bar — a genuine ~3.5 m traversal, all walk guards armed).

Core module (`packages/core/src/field/`, browser-only, TSDoc-gated):
- `chunks.ts` — sparse 16³ Int8 density store, solid-by-default (missing chunk = uniform rock,
  zero allocation), 18³ apron extraction.
- `ops.ts` — dig ops as the only mutation path; op log with chunk-keyed byte-exact undo + replay redo.
- `mesher.ts` — chunked Surface Nets (18³ aprons, 3-of-6 owned-crossing quads); watertight seams
  verified at the 8-chunk corner (zero holes); triangle winding locked by a face-normal test.
- `raycast.ts` — Amanatides–Woo voxel DDA (dig-tool targeting).
- `collider.ts` — per-chunk shell voxel colliders (corner-anchored, off-grid = solid).
- `artifact.ts` — binary chunk files + oplog + v2 manifest + `bakeFieldWorld` (pure; caller writes).

Editor:
- `frontend/lib/field-protocol.ts` + `field-worker.ts` + `field-client.ts` — engine-direct remesh
  worker (its own `/field-worker.js` bundle, isolated realm), transferable buffers, stale-drop client.
- `viewport-host/field-host.ts` — the dig surface (fly camera, dig stroke, dirty-set worker remesh,
  flat/headlamp shading), a sibling of `PreviewHost`.
- `frontend/components/FieldPanel.tsx` + the `/engine.js` channel wiring (`bundle.ts` / `engine.ts` /
  `App.tsx` / `editor-context.ts`) + daemon `field.load` read command.

Dungeon:
- `src/field-world.ts` — `isFieldManifest` gate + `loadFieldWorld` (rebuilds the store from chunk
  files → shell colliders; decodes `.fmesh` render meshes). `world-loader.ts` branches on manifest v2
  before `assertCompatible`; the v1 path is byte-identical below the branch (v1 GPU test stays green).

## Measured numbers

- **Remesh budget (P2): 16³ `meshChunkApron` median 1.134–1.472 ms** on the M1 (bun:test / JSC), under
  the 5 ms ceiling and the ≤2 ms target. NOTE: the plan predicted "well under 1 ms"; the first
  measurement was **~5.7 ms** (a ~3.5 ms fixed per-cell floor from hot-loop overhead). The probe
  disconfirmed the premise; an **output-identical** optimization (flatten CORNER/CUBE_EDGES/AXES tuple
  arrays to `Int8Array`s, drop the `for…of` iterator) brought it to 1.1 ms with bit-identical mesh
  output. This is a bun:test/JSC number; the in-browser (worker) figure is a Safari-gate observation.
- **Full suite: 1473 pass / 1 skip / 0 fail.** Field module added ~30 tests across 7 files.
- **Field-world walk: `advanced = 5.05`, capsule grounded (minY = finalY = 1.15), deterministic 3/3.**

## Deviations from the plan (ADAPT resolutions — the plan draft was wrong in these places)

The plan's task drafts carried unpinned `ADAPT:` anchors and several shapes that contradicted source.
Resolved against the real signatures:
- **`frame.render` shapes:** real `Ambient = {sky,ground,intensity}` (no `color`); real `PointLight =
  {type:"point",position,color,intensity,range}` (flat, not nested); `clearColor` is `Vec4`
  (`vec4.fromValues`), not a plain array. The draft's shapes would not type-check.
- **Material color arity:** the lit shader layout is `{color:"vec4f",specular:"vec4f"}` → color is a
  4-component RGBA; the dungeon `MaterialDescriptor` is `{color:[4-tuple],specular:[4-tuple]}`.
- **`mesh.setPosition` takes `Vec3` (`Float32Array`)**, not a tuple — wrapped at every call.
- **`encodeMeshBlob` returns `ArrayBuffer`** (not Uint8Array); `RenderBlock`/`CollisionBlock` are not
  re-exported from `@furnace/core/scene` (only `MeshBlob` + the two functions).
- **The FieldPanel host cannot be value-imported.** The plan draft did `import { createFieldHost }`,
  which would breach the project-first invariant. The host reaches the chrome ONLY through the
  `/engine.js` runtime channel (bundle.ts virtual re-export → engine.ts `EngineModule` → App.tsx ref →
  editor-context → panel via `useEditor()`), exactly like `PreviewHost`. This expanded T10's file set.
- **`occupancyFromProxy` Y-extent** (F0 T1) and **the F0 T2 trap assertion** were also plan-draft bugs;
  see the F0 report.
- **First-dig bootstrap (T9):** the plan's `raycastField`-miss fallback was unreachable — in virgin
  all-solid rock the raycast hits its own voxel at t=0 (per its contract), so the first dig carved
  around the camera. Fixed to detect the embedded-in-rock case and dig ahead along the aim.

## Guardrail hardening done as part of F1 (the project-first invariant is now STRONGER)

`frontend-no-engine-leakage.test.ts` began covering only `@furnace/core` value-imports. F1's
engine-direct worker + the FieldPanel plumbing forced the invariant to be made machine-enforced
rather than relying on manual `import type` discipline. It now forbids value-imports of **three**
specifiers from the chrome — `@furnace/core`, `field-protocol`, and `viewport-host` (the engine
barrel) — each proven to bite (flip an import → test goes red). The engine-direct worker files carry a
narrow, documented, realm-isolation exemption (their bundle never loads `/engine.js`).

## Findings surfaced (for the user — some out of F1 scope)

1. **`char-move.ts` levitation bug (SHIPPED defect, out of scope, tracked).** `applyGravity`'s rest
   sweep lifts the capsule to `pos.y + STEP_HEIGHT` before the down-sweep; if the lifted pose overlaps
   rock in ANY direction, `castShape` (stopAtPenetration, `core/src/physics/query.ts:157`) returns
   `toi:0` → the capsule levitates +0.4 m/frame while reporting grounded. Fires on any walkable floor
   with < 2.2 m clearance in some direction. **Directly relevant to F1: it digs low tunnels.** The F1
   walk test was sized to > 2.2 m clearance to stay clear of it. Surfaced by F0; the clean fix is the
   mover. (Filed as the "SURFACE: char-move.ts levitation bug" task.)
   **RESOLVED (2026-07-15, pre-gate, on this branch):** `applyGravity` now probes free headroom
   upward and lifts only that far (a penetrating start pose can no longer read as "support at
   lift height"), and rests the capsule `REST_GAP` (2 cm) above its support — exact-contact rest
   was a second latent stall (touching poses made the horizontal slide's stopAtPenetration casts
   return toi 0 with arbitrary normals on flat voxel floors, F1's new normal). Repro + regression:
   `tests/char-move-levitation.gpu.test.ts` (sub-2.2 m room: stands stable AND walks). Full
   dungeon suite green post-fix; probe guards retained as regression insurance.
2. **Mesher degenerate triangles on symmetric surfaces** — harmless to render, relevant to the future
   field→mesh→Jolt collision path. Filed: `docs/backlog/dungeon/field-mesher-degenerate-triangles.md`.
3. **Daemon `field.load` per-chunk containment is a textual `startsWith`, not symlink-resolving.** A
   crafted world dir with a symlinked chunk file could be read outside root — but this is WITHIN the
   daemon's existing trust model (it already executes the project's `editor-extensions.ts`), so it is
   NOT an escalation. Recorded, not gated. A `realpathSync` re-containment would close it fully.
4. **FieldHost lifecycle is v0.** The host is App-owned and survives panel unmount (required to pass the
   leakage guard): re-opening the Field panel throws "already initialized" (surfaced as a status line,
   not an editor crash), and a closed panel's host keeps rendering to a detached canvas. Fine for the
   single-open gate session; a rebind-on-remount is future work.
5. **`loadWorld` is single-cellSize (v0):** a setup-loud guard throws if a loaded world's `cellSize`
   differs from the host's `DEFAULT_CELL_SIZE` (0.25). Multi-cellSize load is future work.

## Known scope-outs (per the plan)

- **In-browser remesh budget** is a Safari-gate observation; the committed number is bun:test/JSC.
- **v0 spawn = camera position**; playerYaw from the fly camera. The baked `playerStart`/`playerYaw` are
  for the dungeon runtime, not re-applied to the editor camera on load.
- **Playwright browser smoke was DEFERRED** to the manual Safari gate (no quick slot in the existing
  headless harness; the daemon test + typechecks are the automated gate for T10).

## The Safari manual gate (the user's checklist)

The headless walk proves collision geometry + traversal; it CANNOT see pixels. The one thing to
actually eyeball is **render↔collision divergence**: the collider is the blocky 0.25 m voxel shell,
the render mesh is the smooth Surface-Nets isosurface, so up to ~one cell of visual/collision mismatch
is expected (most visible at curved walls/floors — the capsule may look slightly above the visual
floor or clip a curved wall). This is the accepted voxel-proxy architecture (same as v1 caves), the
W2 render/collision-divergence lesson — verify it's within tolerance, not a hole.

1. `cd packages/dungeon && bun run edit` → open the editor, open the **Field** panel.
2. New world → the blank canvas shows the ground grid + origin marker, camera above the grid looking
   down; LMB digs the first hole AHEAD along the aim (flat shading: normal-colored, readable faces).
3. Drag-dig a tunnel; toggle **headlamp**; adjust radius (wheel); Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z
   undo/redo. Watch chunk seams for holes/z-fighting.
4. Type a world name (the field is EMPTY by default — required), **Save**, then **Bake + make default**.
5. `bun run dungeon:dev` — **restart the server if it was already running** (the `bun --hot` staleness
   trap) → Safari → the dungeon spawns in the dug space and walks it. Eyeball floor contact + curved
   walls for the render↔collision divergence.
6. `git status` MUST show only `packages/dungeon/worlds/index.json` modified (restore after the gate:
   `git checkout -- packages/dungeon/worlds/index.json`) plus untracked scratch world dirs (gitignored).
   The committed fixtures stay byte-untouched.

## Commit chain (17 commits, `1740219`..`9f748f9`, atop F0's `dd56708`)

Core: chunk store → ops (+ mutation-guard fix) → mesher (+ winding lock) → mesher perf → raycast →
collider → artifact. Editor: worker (+ guard) → FieldHost (+ bootstrap fix) → FieldPanel (+ guard).
Dungeon: v2 loader. Plus one backlog doc. All LOCAL/unpushed.
