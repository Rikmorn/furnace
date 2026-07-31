# The scene chrome returns when a consumer needs scene-doc editing

F4.5a made the editor **field-only** on a deliberate ruling taken when the slice was
chartered: the editor serves the FIELD, and the dungeon — its sole consumer — authors
worlds by digging a field, not by editing a scene document. The whole scene-document
chrome went with that ruling — the scene picker, the entity tree, the inspector-as-entity-editor, the picking/gizmo viewport, `refreshSession`
and the echo-suppression path (F4.5a Task 4; the deleted surfaces are described as
history in `docs/reference/editor-architecture.md` §7, §10–§12).

**The DAEMON layer was deliberately kept.** `scene.list` / `read` / `open` / `get` /
`save` / `validate` / `introspect` / `batch` / `undo` / `redo`, the mutable document
session with its transactional registry-validated mutations and snapshot undo/redo, the
scene-file watcher and its conflict semantics, and the node registry bundle are all still
implemented and still tested. Nothing calls them from the chrome. That is the whole
consequence of the field-only ruling: **the cost is a consumer-facing capability parked,
not deleted.**

`packages/hello-world` is the concrete casualty — its `bun run edit` opens an editor that
can no longer open its scene. It still runs as the reference consumer for the engine; it
just has no editing surface.

Reviving it is not a re-implementation from zero: the daemon half is intact, the inspector
module (`frontend/inspector/` — SchemaForm, the kind→renderer registry, the scrub
affordance) survives as the stamp/reconfigure param form, and `viewport-host/gizmo.ts` +
`camera-control.ts` are live, tested pure math again (F4.5b promoted both into the FIELD
host — the scene camera's `orbit`/`zoom`/`pan`/`fromEyeTarget` were deleted there, so a
revived scene surface would drive `orbitAbout`/`dolly`/`frameBox`/`snapToAxis` instead).
What has to be rebuilt is the chrome: a document surface in the overlay shell's
idiom (palettes over a canvas), not the dock the old one assumed.

**Trigger to revisit:** a consumer project needs scene-document editing — most likely
`packages/hello-world` regaining a real editing story, or a second consumer app arriving
that composes scenes rather than digging fields. Until then the daemon surface stays as
the parked capability and this entry is what says so on purpose.

**Reference:** `docs/reference/editor-architecture.md` §20 (the field-only as-built) and
§7/§10–§12 (the deleted chrome, kept as history); `packages/editor/src/daemon/handlers.ts`
(the live `scene.*` family).
