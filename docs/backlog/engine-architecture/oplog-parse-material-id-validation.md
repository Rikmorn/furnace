# `parseOps` cannot resolve a patch op's material class ids

The F3a oplog v2 codec (`packages/core/src/field/artifact.ts`) made `parseOps` a real
trust boundary: it decodes base64 patch payloads from an untrusted file and validates
them with `assertPatchStructure` — canonical unique chunk keys, 512-byte masks, value
arrays exactly as long as their mask's popcount. That covers every corruption shape the
BYTES can take, so a truncated payload is rejected rather than mis-applied.

What it cannot cover is the one table-dependent leg of `assertPatchValid`: that each id
in a slice's `materials` resolves in a `MaterialTable`. `parseOps(text)` does not take a
table, and giving it one changes a public signature with live callers (the editor's
`FieldHost.loadWorld`, which pushes the parsed ops straight into `log.ops`). The
consequence today is narrow — the editor loads chunk bytes from `chunks/*.bin` and never
re-applies the log, so an unknown id only surfaces later, when a reconfigure or a
compaction replays that patch and the mesher's `classOf` throws at a confusing place
rather than at load. It is the same gap brush ops already have (`material: 99` parses
fine and only fails on apply), so the codec is not making anything worse; it is simply
the one invariant the parse-time check cannot state.

The load path DOES have a table to hand: `FieldManifest.materialTable` is embedded in
every v2 manifest (artifact self-containment), and `loadWorld` already reads the manifest
beside the oplog. So the fix is available whenever it is judged worth the signature
change — an optional `table` parameter, or a separate `assertOplogAgainstTable(ops,
table)` the editor calls after parsing (which keeps `parseOps` single-argument and
matches the escape-hatch-as-standalone-function posture).

**Trigger to revisit:** the first time a patch op reaches a baked oplog from a source
other than `logApplyPatch` (i.e. when the compaction verb ships), or the first
mesh-time `classOf` throw whose root cause turns out to be a loaded oplog.

**Reference:** `docs/reference/core-modules.md` §field "The oplog wire format (F3a)" —
the WHAT IS / WHAT IS NOT CHECKED split; `assertPatchValid` / `assertPatchStructure` in
`packages/core/src/field/ops.ts`.
