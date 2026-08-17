---
summary: `field/artifact.ts` carries four unrelated serialization formats in one file, and the oplog region inside it is now the field's security boundary wearing a filename about baking artifacts
---

# `field/artifact.ts` is four codecs in one file

**Every count below was taken at a specific dated moment against a specific file — line
counts and declaration counts must be RE-DERIVED at pickup, not trusted from this text.**
(`wc -l packages/core/src/field/artifact.ts`.) The sibling entries this one was filed
alongside each carry the same instruction in their own words; it lived in their shared
tracker's preamble until that tracker was un-merged at genre-contracts, and this is the one
of the six whose numbers are typed rather than derived.

`packages/core/src/field/artifact.ts` is 1370 lines carrying four unrelated
serialization formats that share nothing but a directory:

- the **chunk file** (`FFC1`) — `encodeChunkFile` / `decodeChunkFile`
- the **material file** (`FFM1`) — `encodeMaterialFile` / `decodeMaterialFile`
- the **oplog** (v1 bare array / v2 / v3 envelope) — `serializeOps` / `parseOps`
- the **placement artifact** (D-F3-10) — `serializePlacements` / `parsePlacements`

plus `bakeFieldWorld`, which is the only thing that touches more than one of them.

Measured at `1c47b84e` (T4a Task 4): 80 top-level declarations, 13 exported. The
**oplog codec alone is 822 lines and 47 declarations** (L175–L996, `OPLOG_VERSION`
to the placement-artifact banner) for **two** exported names. T4a Task 4 added 262
lines to this file and removed 61 — nearly all of it in that one region, which is
what surfaced this.

## Context

The oplog decoder is no longer a decoder. T4a reframed it as the field's
**security boundary** (`docs/reference/core-modules.md` §field, "The oplog wire
format"): untrusted bytes in, typed engine objects out, and nothing downstream
re-examines them. That region now holds a wire-shape layer, per-member vector
tables, a locator wrapper, an entity-record validator and the seam onto the
engine's value predicates — a coherent module wearing a filename about baking
artifacts, sharing a file with three binary formats that have no validation story
at all.

Extraction needs **no public-API change**: `parseOps` / `serializeOps` are already
re-exported by name from `packages/core/src/field/index.ts`, so an `oplog-codec.ts`
is an internal move. `bakeFieldWorld` would import it exactly as it imports
`chunks.ts` and `mesher.ts` today.

This is the sibling of `field-ops-wants-a-four-concern-split.md`, one file over. Both were
named by the same pressure — the field's op vocabulary and its wire format are
each outgrowing the file they were filed in.

## Trigger to revisit

- The next tranche that adds to the oplog codec specifically (a `MaterialTable`
  parameter for class-id resolution — `parseops-cannot-resolve-a-class-id.md`
  — would land squarely here).
- Or a fifth format arriving in this file.
- Or `field-ops-wants-a-four-concern-split.md` firing: if `ops.ts` splits, the oplog
  codec's dependency on it becomes a set of module edges worth drawing once.

Not before then. The file is legible today and the split is pure motion; doing it
inside a tranche that also changes behaviour would make the behaviour change
unreviewable.

## Reference

- `packages/core/src/field/artifact.ts`; the four format groups above.
- `docs/reference/core-modules.md` §field — "The oplog wire format".
- Siblings: `field-ops-wants-a-four-concern-split.md`,
  `parseops-cannot-resolve-a-class-id.md`.
