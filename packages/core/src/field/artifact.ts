import { encodeMeshBlob } from "../mesh-blob/index.ts";
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  extractFieldAprons,
  parseChunkKey,
} from "./chunks.ts";
import { meshChunkField } from "./mesher.ts";
import {
  assertOpStructure,
  assertPatchStructure,
  assertPlacementsValid,
} from "./ops.ts";
import { skinChunkKit } from "./skin.ts";
import type {
  BrushMask,
  BrushOp,
  BrushShape,
  ChunkKey,
  ChunkMaterials,
  EntityOp,
  FieldManifest,
  FieldOp,
  FieldStore,
  GeneratorEntity,
  MaterialTable,
  OpLog,
  PatchChunk,
  PatchOp,
  PlacementOp,
  PlacementRecord,
  SelectionSpec,
  SmoothParams,
} from "./types.ts";
import { MAT_ROCK } from "./types.ts";

const CHUNK_MAGIC = 0x46_46_43_31; // "FFC1"
const CHUNK_FILE_VERSION = 1;
const CHUNK_HEADER_BYTES = 8; // magic(4) + version(4)

// Material file (FFM1): mirrors the chunk file's little-endian u32 header. The
// magic constant + version are what interop hinges on; encode/decode agree on
// endianness so the on-disk byte order is an internal detail.
const MAT_MAGIC = 0x46_46_4d_31; // "FFM1"
const MAT_FILE_VERSION = 1;
const MAT_HEADER_BYTES = 8; // magic(4) + version(4)
const MAT_KIND_UNIFORM = 0;
const MAT_KIND_INDEXED = 1;

/** One entry of a baked file set: a repo-relative path and its bytes/text. */
export type BakedFile = { path: string; contents: string | Uint8Array };

/**
 * Encodes one chunk's densities as a binary file: `magic(4) + version(4) +
 * 4096 Int8` samples. Int8 and Uint8 share their byte representation, so the
 * payload is copied byte-for-byte.
 */
export function encodeChunkFile(chunk: Int8Array): Uint8Array {
  const out = new Uint8Array(CHUNK_HEADER_BYTES + CHUNK_SAMPLES);
  const view = new DataView(out.buffer);
  view.setUint32(0, CHUNK_MAGIC, true);
  view.setUint32(4, CHUNK_FILE_VERSION, true);
  out.set(
    new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    CHUNK_HEADER_BYTES,
  );
  return out;
}

/**
 * Decodes a chunk file produced by {@link encodeChunkFile}.
 *
 * @throws {@link Error} if the length, magic number, or version is wrong.
 */
export function decodeChunkFile(bytes: Uint8Array): Int8Array {
  if (bytes.byteLength !== CHUNK_HEADER_BYTES + CHUNK_SAMPLES) {
    throw new Error(`field chunk file: bad length ${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== CHUNK_MAGIC) {
    throw new Error("field chunk file: bad magic");
  }
  if (view.getUint32(4, true) !== CHUNK_FILE_VERSION) {
    throw new Error("field chunk file: unknown version");
  }
  return new Int8Array(
    bytes.buffer,
    bytes.byteOffset + CHUNK_HEADER_BYTES,
    CHUNK_SAMPLES,
  ).slice();
}

/**
 * Encodes one chunk's material storage as a binary file: `magic(4) + version(4)
 * + kind(1)`, then either a uniform `classId(1)` or an indexed `paletteLen(1) +
 * palette(paletteLen) + bits(1) + packed(ceil(CHUNK_SAMPLES·bits/8))`. Mirrors
 * {@link encodeChunkFile}'s little-endian u32 header; the payload matches the
 * private {@link ChunkMaterials} encoding byte-for-byte.
 */
export function encodeMaterialFile(m: ChunkMaterials): Uint8Array {
  const bodyLen =
    m.kind === "uniform"
      ? 2 // kind(1) + classId(1)
      : 3 + m.palette.length + m.packed.length; // kind + paletteLen + bits + palette + packed
  const out = new Uint8Array(MAT_HEADER_BYTES + bodyLen);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAT_MAGIC, true);
  view.setUint32(4, MAT_FILE_VERSION, true);
  if (m.kind === "uniform") {
    out[MAT_HEADER_BYTES] = MAT_KIND_UNIFORM;
    out[MAT_HEADER_BYTES + 1] = m.classId;
    return out;
  }
  let o = MAT_HEADER_BYTES;
  out[o++] = MAT_KIND_INDEXED;
  out[o++] = m.palette.length;
  out.set(m.palette, o);
  o += m.palette.length;
  out[o++] = m.bits;
  out.set(m.packed, o);
  return out;
}

/**
 * Decodes a material file produced by {@link encodeMaterialFile}.
 *
 * @throws {@link Error} if the magic number, version, or kind byte is wrong, or
 *   if the packed region is not `ceil(CHUNK_SAMPLES · bits / 8)` bytes.
 */
export function decodeMaterialFile(bytes: Uint8Array): ChunkMaterials {
  if (bytes.byteLength < MAT_HEADER_BYTES + 2) {
    throw new Error(`field material file: bad length ${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAT_MAGIC) {
    throw new Error("field material file: bad magic");
  }
  if (view.getUint32(4, true) !== MAT_FILE_VERSION) {
    throw new Error("field material file: unknown version");
  }
  let o = MAT_HEADER_BYTES;
  const kind = bytes[o++] as number;
  if (kind === MAT_KIND_UNIFORM) {
    // Strict exact length, symmetric with the indexed branch's packed check and
    // with encodeChunkFile's decoder: a uniform file is header + kind + classId,
    // nothing more — trailing bytes mean corruption.
    if (bytes.byteLength !== MAT_HEADER_BYTES + 2) {
      throw new Error("field material file: bad uniform length");
    }
    return { kind: "uniform", classId: bytes[o] as number };
  }
  if (kind !== MAT_KIND_INDEXED) {
    throw new Error(`field material file: unknown kind ${kind}`);
  }
  const paletteLen = bytes[o++] as number;
  const palette = bytes.slice(o, o + paletteLen);
  o += paletteLen;
  const bits = bytes[o++] as number;
  const expectedPacked = Math.ceil((CHUNK_SAMPLES * bits) / 8);
  const available = bytes.byteLength - o;
  if (available !== expectedPacked) {
    throw new Error(
      `field material file: packed length ${available} != expected ${expectedPacked}`,
    );
  }
  const packed = bytes.slice(o, o + expectedPacked);
  return { kind: "indexed", palette, bits, packed };
}

/** Oplog envelope version. v1 was a BARE JSON array of ops (no envelope) and is
 *  still read; v2 wraps the list so patch ops can carry base64 payloads; v3
 *  adds placement ops (literal JSON — no binary payload). {@link parseOps} reads
 *  all three (a v2 file carries no placement ops by construction); the writer
 *  always emits the current version. */
const OPLOG_VERSION = 3;

/** Bytes per binary-string step in {@link u8ToB64} — bounds the transient char
 *  array at 32K entries whatever the payload's size (a compaction patch over a
 *  large span runs to megabytes, and an unchunked pass allocates one entry per
 *  byte). NOT an argument-count ceiling: nothing here spreads. The usual
 *  `String.fromCharCode(...bytes)` idiom is the one this module's neighbours
 *  already refuse for caller-sized data (`spliceOps`, `commitGenerator` in
 *  `ops.ts`/`generators.ts`), and measured on JSC it is also SLOWER here than
 *  the array+join below. */
const B64_CHUNK_BYTES = 0x8000;

/** Bytes → base64, in bounded steps. */
function u8ToB64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += B64_CHUNK_BYTES) {
    const end = Math.min(i + B64_CHUNK_BYTES, bytes.length);
    const chars = new Array<string>(end - i);
    for (let j = i; j < end; j++)
      chars[j - i] = String.fromCharCode(bytes[j] ?? 0);
    parts.push(chars.join(""));
  }
  return btoa(parts.join(""));
}

/** Base64 → a FRESH, exactly-sized byte buffer.
 *
 *  @throws {@link Error} (a DOM `InvalidCharacterError`) on non-base64 input —
 *    {@link decodeSliceBytes} is what turns that into a located message. */
function b64ToU8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A byte view over a typed array, whatever its element type — Int8 and Uint8
 *  share their byte representation, so density rides the same encoder. */
const bytesOf = (a: Int8Array | Uint8Array): Uint8Array =>
  new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Wire form of one {@link PatchChunk}: the four typed arrays as base64 (a
 *  nulled material pair stays null). */
type WirePatchChunk = {
  key: ChunkKey;
  densityMask: string;
  density: string;
  materialMask: string | null;
  materials: string | null;
};

const encodePatchChunk = (c: PatchChunk): WirePatchChunk => ({
  key: c.key,
  densityMask: u8ToB64(c.densityMask),
  density: u8ToB64(bytesOf(c.density)),
  materialMask: c.materialMask === null ? null : u8ToB64(c.materialMask),
  materials: c.materials === null ? null : u8ToB64(c.materials),
});

/**
 * Serializes the op list (the authoring truth — brush, entity, patch AND
 * placement ops) as the current envelope: `{ version, ops }`, with each patch
 * slice's typed arrays as base64 strings. Plain `JSON.stringify` would render
 * them as index-keyed objects (`{"0":…}`) — ~8× the bytes, and no longer typed
 * arrays on the way back. Placement ops are plain JSON, so they ride the
 * envelope literally (the `: op` pass-through below).
 *
 * The writer TRUSTS its input: `logApplyPatch` validated every patch on the way
 * into the log, so re-checking here would only re-do work. {@link parseOps},
 * which reads a file the process did not write, does not.
 */
export const serializeOps = (ops: FieldOp[]): string =>
  JSON.stringify({
    version: OPLOG_VERSION,
    ops: ops.map((op) =>
      op.kind === "patch"
        ? { ...op, chunks: op.chunks.map(encodePatchChunk) }
        : op,
    ),
  });

/** Non-null, non-array object narrowing for the untrusted JSON tree. */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** What an unexpected JSON value IS, for the error message — `typeof` alone
 *  calls both `null` and `[]` "object". Use where the VALUE could be large
 *  (a whole op, the whole file). */
function typeTag(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** The offending value itself, quoted, for the error message — use where it is
 *  small and naming it is the whole point (a bad `kind`, `effect`, `version`).
 *  `JSON.stringify` returns the VALUE `undefined` for `undefined`, so absence
 *  would otherwise vanish from the message instead of reading as "undefined". */
const jsonTag = (v: unknown): string => JSON.stringify(v) ?? "undefined";

/** Runs an engine value-predicate over one decoded op and re-throws whatever it
 *  says under this file's locator. The decoder owns WHERE, the predicate owns
 *  WHAT: `field oplog: op 7 — field op: sphere radius must be a finite positive
 *  length (metres)`.
 *
 *  It exists because the predicates were written for the COMMIT path, where the
 *  op in hand is the one the user just drew and needs no locator. On the load
 *  path there is a file of them, and "which op" is the whole question — the gap
 *  {@link assertPlacementsValid}'s locator-free messages have always had. The
 *  original rides `cause`, so a caller that wants the predicate's own message
 *  back can still have it.
 *
 *  The locator is the op's wire `id`, not its array index, because that is what
 *  every other message in this file names, what {@link decodeOp} has already
 *  proved is an integer, and what an author of a hand- or agent-written log sees
 *  when they look at the record. A corrupt log CAN repeat an id, which the index
 *  would disambiguate — but a second locator style in one function's output
 *  costs more than that, and duplicate ids are a structural fault this decoder
 *  does not check either way. */
function atOp<T>(id: number, run: () => T): T {
  try {
    return run();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`field oplog: op ${id} — ${detail}`, { cause: e });
  }
}

/** Decodes one required base64 field of a patch slice.
 *
 *  @throws {@link Error} if it is absent, not a string, or not valid base64 —
 *    named by chunk key and field, since a bad oplog gives no other context. */
function decodeSliceBytes(
  slice: Record<string, unknown>,
  name: string,
  key: string,
): Uint8Array {
  const raw = slice[name];
  if (typeof raw !== "string")
    throw new Error(
      `field oplog: chunk "${key}" ${name} must be a base64 string`,
    );
  try {
    return b64ToU8(raw);
  } catch {
    throw new Error(`field oplog: chunk "${key}" ${name} is not valid base64`);
  }
}

/** {@link decodeSliceBytes} for the nullable material pair. A MISSING field is
 *  not the same as an explicit `null` — it falls through and is rejected. */
const decodeSliceBytesOrNull = (
  slice: Record<string, unknown>,
  name: string,
  key: string,
): Uint8Array | null =>
  slice[name] === null ? null : decodeSliceBytes(slice, name, key);

/** @throws {@link Error} if the slice is not an object, has no string key, or
 *   carries a payload that is not decodable base64. */
function decodePatchChunk(raw: unknown): PatchChunk {
  if (!isRecord(raw))
    throw new Error("field oplog: a patch chunk is not a JSON object");
  const key = raw["key"];
  if (typeof key !== "string")
    throw new Error(
      `field oplog: patch chunk key must be a string, got ${typeTag(key)}`,
    );
  const densityMask = decodeSliceBytes(raw, "densityMask", key);
  const density = decodeSliceBytes(raw, "density", key);
  return {
    key,
    densityMask,
    // Three-arg view rather than `density.buffer`: correct even if b64ToU8 ever
    // returns a view INTO a larger buffer instead of a fresh exact-sized one.
    density: new Int8Array(
      density.buffer,
      density.byteOffset,
      density.byteLength,
    ),
    materialMask: decodeSliceBytesOrNull(raw, "materialMask", key),
    materials: decodeSliceBytesOrNull(raw, "materials", key),
  };
}

/** @throws {@link Error} if the op has no chunks array, or if the reconstructed
 *   patch fails {@link assertPatchStructure} (under this op's locator — see
 *   {@link atOp}). */
function decodePatchOp(raw: Record<string, unknown>, id: number): PatchOp {
  const chunks = raw["chunks"];
  if (!Array.isArray(chunks))
    throw new Error(`field oplog: patch op ${id} has no chunks array`);
  const op: PatchOp = {
    id,
    kind: "patch",
    chunks: chunks.map(decodePatchChunk),
  };
  atOp(id, () => assertPatchStructure(op));
  return op;
}

/** Narrows an untrusted JSON value to exactly `len` numbers — the SHAPE half of
 *  every fixed-length vector on the wire: a placement record's
 *  `position`/`quat`/`scale`, a brush shape's `center`/`halfExtents`/capsule
 *  endpoints, an embedded selection's `seed` or region bounds, an entity
 *  record's `region` bounds and `opSpan`. The matching engine predicate checks
 *  the VALUES; this is what stops it meeting a scalar or an absent field and
 *  raising a raw TypeError off `.every` or a destructure.
 *
 *  It does NOT check finiteness — the value predicate downstream does, with a
 *  message that names the quantity ("radius", "region bounds") rather than the
 *  container. Note which cases actually reach it from a FILE: JSON has no `NaN`
 *  and no `Infinity` literal, and `JSON.stringify` writes both as `null`, so a
 *  laundered NaN arrives as `[null, 1, 2]` and dies HERE, on `typeof`. The one
 *  spelling that survives to the predicate is an out-of-range exponent —
 *  `JSON.parse("1e999")` is `Infinity`. Both are pinned in `artifact.test.ts`.
 *
 *  @throws {@link Error} if it is not an array of `len` numbers. */
function numberArray(
  raw: unknown,
  len: number,
  id: number,
  what: string,
): number[] {
  if (
    !Array.isArray(raw) ||
    raw.length !== len ||
    raw.some((n) => typeof n !== "number")
  )
    throw new Error(
      `field oplog: op ${id} ${what} must be an array of ${len} numbers`,
    );
  return raw;
}

/** Narrows one JSON value to a {@link PlacementRecord}: `archetypeId` string,
 *  `position`/`scale` 3-number arrays, `quat` a 4-number array, `variantIndex` a
 *  number. Shape only — {@link assertPlacementsValid} validates the VALUES.
 *
 *  @throws {@link Error} if the record is not an object or a field has the wrong
 *    JSON shape. */
function decodePlacementRecord(raw: unknown, id: number): PlacementRecord {
  if (!isRecord(raw))
    throw new Error(`field oplog: placement op ${id} record is not an object`);
  const archetypeId = raw["archetypeId"];
  if (typeof archetypeId !== "string")
    throw new Error(
      `field oplog: placement op ${id} archetypeId must be a string`,
    );
  const variantIndex = raw["variantIndex"];
  if (typeof variantIndex !== "number")
    throw new Error(
      `field oplog: placement op ${id} variantIndex must be a number`,
    );
  // Boundary cast: numberArray verified length + element types at runtime just
  // above; the fixed-length tuple shapes the type system cannot recover from a
  // length check.
  return {
    archetypeId,
    position: numberArray(raw["position"], 3, id, "position") as [
      number,
      number,
      number,
    ],
    quat: numberArray(raw["quat"], 4, id, "quat") as [
      number,
      number,
      number,
      number,
    ],
    scale: numberArray(raw["scale"], 3, id, "scale") as [
      number,
      number,
      number,
    ],
    variantIndex,
  };
}

/** @throws {@link Error} if the op has no records array, a record has a bad JSON
 *   shape ({@link decodePlacementRecord}), or a record's values are invalid
 *   ({@link assertPlacementsValid} — non-unit quat, non-finite vector, etc.,
 *   under this op's locator — see {@link atOp}). */
function decodePlacementOp(
  raw: Record<string, unknown>,
  id: number,
): PlacementOp {
  const records = raw["records"];
  if (!Array.isArray(records))
    throw new Error(`field oplog: placement op ${id} has no records array`);
  const op: PlacementOp = {
    id,
    kind: "placement",
    records: records.map((r) => decodePlacementRecord(r, id)),
  };
  atOp(id, () => assertPlacementsValid(op.records));
  return op;
}

/** The CLOSED string unions an op's wire form must land in. Every one of them
 *  is table-INDEPENDENT — the same license {@link assertPatchStructure} runs on
 *  for patch slices — so the decoder checks them here rather than deferring to
 *  an applier that trusts its input by contract.
 *
 *  KEYED RECORDS, not arrays: `satisfies Record<Union, true>` is exhaustive in
 *  BOTH directions. Renaming or removing a member in `types.ts` breaks the build
 *  here (TS2353), and so does ADDING one (TS1360) — without which the engine
 *  could emit an op its own parser refuses at load, with nothing in CI to say
 *  so. A `readonly Union[]` array with `satisfies` catches only the first. */
const BRUSH_EFFECTS = {
  dig: true,
  fill: true,
  paint: true,
  smooth: true,
} as const satisfies Record<BrushOp["effect"], true>;
const SHAPE_KINDS = {
  sphere: true,
  box: true,
  capsule: true,
} as const satisfies Record<BrushShape["kind"], true>;
const ENTITY_ACTIONS = {
  place: true,
} as const satisfies Record<EntityOp["action"], true>;
const ENTITY_TYPES = {
  generator: true,
} as const satisfies Record<GeneratorEntity["type"], true>;
const MASK_KINDS = {
  "organic-only": true,
  "kit-only": true,
  class: true,
  "solid-only": true,
  selection: true,
} as const satisfies Record<BrushMask["kind"], true>;
const SELECTION_KINDS = {
  region: true,
  "flood-material": true,
  "flood-void": true,
} as const satisfies Record<SelectionSpec["kind"], true>;
const SMOOTH_MODES = {
  both: true,
  erode: true,
  fill: true,
} as const satisfies Record<SmoothParams["mode"], true>;

/** @throws {@link Error} if `value` is not a key of `allowed`. */
function assertOneOf(
  value: unknown,
  allowed: Record<string, true>,
  what: string,
  id: number,
): void {
  // hasOwn, not `in`: `"toString" in allowed` is true for every object.
  if (typeof value === "string" && Object.hasOwn(allowed, value)) return;
  throw new Error(
    `field oplog: op ${id} ${what} must be one of ${Object.keys(allowed).join("|")}, got ${jsonTag(value)}`,
  );
}

/** An OPTIONAL sub-record of an op. Absent is legal; present-but-not-a-record
 *  is not — unguarded it sails past every field check below it (measured: a
 *  `mask: 42` parsed, then applied zero cells).
 *
 *  @throws {@link Error} if `name` is present and not a JSON object. */
function optionalRecord(
  raw: Record<string, unknown>,
  name: string,
  id: number,
): Record<string, unknown> | undefined {
  const value = raw[name];
  if (value === undefined) return undefined;
  if (!isRecord(value))
    throw new Error(
      `field oplog: op ${id} ${name} must be an object, got ${typeTag(value)}`,
    );
  return value;
}

/** The array-valued keys of one union member — the only fields the tables below
 *  may list, derived from the member's own type rather than restated. */
type ArrayKeys<T> = {
  [K in keyof T]-?: T[K] extends readonly unknown[] ? K : never;
}[keyof T];

/** Shape of a per-member vector table: every member of the union, each mapping
 *  ITS OWN array fields to their required length.
 *
 *  Three failure modes, all compile errors — verified by building each against
 *  the shipped types. A missing member is TS1360 (key exhaustiveness in both
 *  directions, same as the discriminator tables above). A MISSPELT field is
 *  TS2561, `'centre' does not exist … Did you mean to write 'center'?` — which
 *  a `readonly string[]` value type cannot catch at all, and the runtime cost of
 *  that typo is total: the narrowing would reject every valid op of that member.
 *  A non-array field listed as a vector (`radius: 3`) is TS2353, because
 *  {@link ArrayKeys} filters the keys by their VALUE type.
 *
 *  The length is data in the table, not a literal at the call site, so a future
 *  4-vector field (an oriented box's quat, say) is narrowed to 4 by writing 4
 *  here — where a hardcoded `numberArray(…, 3, …)` in the loop would have
 *  silently truncated it. */
type VectorFieldsOf<U extends { kind: string }> = {
  [K in U["kind"]]: Readonly<
    Partial<Record<ArrayKeys<Extract<U, { kind: K }>>, number>>
  >;
};

/** The fixed-length vector fields each union member carries, keyed by its
 *  discriminator.
 *
 *  Only the ARRAY fields are listed. A scalar (`radius`, `budget`, `classId`)
 *  needs no narrowing: the engine predicate reaches it through
 *  `Number.isFinite`/`Number.isInteger`, which are false for a string, for
 *  `null` and for an absent field — so narrowing here would only duplicate the
 *  check, with a worse message. An array field is different: the predicate
 *  reads it with `.every` or a destructure, both of which raise a raw TypeError
 *  on a scalar, far from the corrupt file. */
const SHAPE_VECTORS = {
  sphere: { center: 3 },
  box: { center: 3, halfExtents: 3 },
  capsule: { a: 3, b: 3 },
} as const satisfies VectorFieldsOf<BrushShape>;
const SELECTION_VECTORS = {
  region: { min: 3, max: 3 },
  "flood-material": { seed: 3 },
  "flood-void": { seed: 3 },
} as const satisfies VectorFieldsOf<SelectionSpec>;

/** The mask leg: its own discriminator, an embedded selection's, and the array
 *  SHAPE of whatever vectors that selection kind carries. Class ids
 *  (`mask.classId`, `selection.classId`) are validated by {@link
 *  assertOpStructure} for storability and by {@link assertOpValid} — which this
 *  path does not reach — for table membership.
 *
 *  @throws {@link Error} if `mask` is present and not a record, its `kind` is
 *    off-contract, a selection mask's `selection` is absent/off-contract, or one
 *    of that selection's vectors is not an array of three numbers. */
function assertMaskWire(raw: Record<string, unknown>, id: number): void {
  const mask = optionalRecord(raw, "mask", id);
  if (mask === undefined) return;
  assertOneOf(mask["kind"], MASK_KINDS, "mask.kind", id);
  if (mask["kind"] !== "selection") return;
  const selection = mask["selection"];
  if (!isRecord(selection))
    throw new Error(
      `field oplog: op ${id} mask.selection must be an object, got ${typeTag(selection)}`,
    );
  assertOneOf(selection["kind"], SELECTION_KINDS, "mask.selection.kind", id);
  // Boundary cast: assertOneOf just proved `kind` is an own key of
  // SELECTION_KINDS, whose keys ARE SelectionSpec["kind"] by construction.
  const kind = selection["kind"] as SelectionSpec["kind"];
  for (const [name, len] of Object.entries(SELECTION_VECTORS[kind]))
    numberArray(selection[name], len, id, `mask.selection.${name}`);
}

/** The smooth leg — its `mode` only. `strength`/`iterations` are numeric and
 *  reach {@link assertSmoothValid} through {@link assertOpStructure}, which
 *  needs no narrowing for them (see {@link SHAPE_VECTORS}).
 *
 *  The mode is checked whenever `smooth` is PRESENT, where the numbers are
 *  checked only on a smooth-effect op — because `assertOpValid` ignores the
 *  params of a non-smooth op, and the load path must not reject what the commit
 *  path accepts. A discriminator is the one part that can be checked either way
 *  for free, and this leg predates the numeric wiring.
 *
 *  @throws {@link Error} if `smooth` is present and not a record, or its `mode`
 *    is off-contract. */
function assertSmoothWire(raw: Record<string, unknown>, id: number): void {
  const smooth = optionalRecord(raw, "smooth", id);
  if (smooth === undefined) return;
  assertOneOf(smooth["mode"], SMOOTH_MODES, "smooth.mode", id);
}

/** The shape leg shared by a brush op and the legacy-dig upgrade; `kindLabel`
 *  names which for the message. Discriminator, then the array shape of the
 *  vectors that member carries.
 *
 *  @throws {@link Error} if the shape is absent, its `kind` is off-contract, or
 *    one of its vectors is not an array of three numbers. */
function assertShapeWire(
  shape: unknown,
  id: number,
  kindLabel: "brush" | "legacy dig",
): void {
  if (!isRecord(shape))
    throw new Error(`field oplog: ${kindLabel} op ${id} has no shape object`);
  assertOneOf(shape["kind"], SHAPE_KINDS, "shape.kind", id);
  // Boundary cast: assertOneOf just proved `kind` is an own key of SHAPE_KINDS,
  // whose keys ARE BrushShape["kind"] by construction.
  const kind = shape["kind"] as BrushShape["kind"];
  for (const [name, len] of Object.entries(SHAPE_VECTORS[kind]))
    numberArray(shape[name], len, id, `shape.${name}`);
}

/** @throws {@link Error} if a brush op's `effect` or `shape.kind` is
 *   off-contract, it carries no shape object, a vector is not an array of three
 *   numbers, or its OPTIONAL `mask`/`smooth` legs are off-contract. */
function assertBrushWire(raw: Record<string, unknown>, id: number): void {
  assertOneOf(raw["effect"], BRUSH_EFFECTS, "effect", id);
  assertShapeWire(raw["shape"], id, "brush");
  assertMaskWire(raw, id);
  assertSmoothWire(raw, id);
}

/** Whether a value is a usable LOG ID: a non-negative integer. Ids are handed
 *  out by `log.nextId` counting up from 0, so nothing legitimate is negative or
 *  fractional. Every id on the wire goes through this — the op's own `id` in
 *  {@link decodeOp}, an entity record's `entityId`, and both ends of its
 *  `opSpan` — because they are the SAME quantity: an entity's `entityId` IS
 *  some op's `id`, and `opSpan` names two more. Measured across the six worlds
 *  in `packages/dungeon/worlds/`, all 4792 op ids fall in [1, 8976].
 *
 *  `Number.isInteger` is the whole test: it is false for a string, for `null`,
 *  for `undefined` and for NaN, so a `typeof` guard in front of it is dead
 *  (the same reason `assertClassId` in `ops.ts` omits one). A type predicate, so
 *  the caller that needs the narrowed value gets it without its own cast.
 *
 *  Boundary cast: `Number.isInteger` narrows nothing for the type system but is
 *  true only of numbers, so the comparison behind it is reading a number. */
const isLogId = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0;

/** {@link isLogId} as a located assertion, for ids reached from an op that has
 *  already been located. `decodeOp` cannot use this for the op's OWN id — that
 *  id is the locator — so it spells the same predicate with its own message.
 *
 *  A bad id does not fail loudly downstream, it fails SILENTLY: a NaN or
 *  fractional id makes every id COMPARISON false, which is how an entity's span
 *  attribution quietly stops matching any op.
 *
 *  @throws {@link Error} if `value` is not a non-negative integer. */
function assertLogId(value: unknown, what: string, id: number): void {
  if (!isLogId(value))
    throw new Error(
      `field oplog: op ${id} ${what} must be a non-negative integer, got ${jsonTag(value)}`,
    );
}

/** The numeric interior of a {@link GeneratorEntity}. Written here rather than
 *  wired to an engine predicate because there is no engine predicate to wire:
 *  `assertOpValid` takes a {@link BrushOp}, and NOTHING validates an entity op
 *  on the commit path — `commitGenerator` builds the record itself from values
 *  it already holds. That makes this the only guard the record ever gets, and it
 *  is deliberately the ARITHMETIC one: `generator` (a def id) and `params` (a
 *  def-specific bag) are not numbers and are not this task's business.
 *
 *  What each number costs when it is wrong: a non-integer `entityId` or
 *  `opSpan` breaks the id comparisons every span verb is built on
 *  (`reconfigureGenerator` locating its span, `placementsByEntity` attributing a
 *  placement op); a non-finite `seed` is silently laundered into seed 0 by
 *  `rng.create`'s `seed >>> 0`, so a reconfigure re-cooks a DIFFERENT world than
 *  the one on disk; a non-finite `region` bound reaches `reconfigureGenerator`
 *  and from there the generator's own sampling loop.
 *
 *  `opSpan` is checked for two non-negative integers and no more. Ordering is
 *  NOT checked: `reconfigure` writes `[firstId, firstId + newSpan.length - 1]`,
 *  which is legitimately reversed for an empty re-cooked span.
 *
 *  It also checks the two NON-numeric fields whose contract the boundary cast
 *  destroys — `frozen`/`baked`, see below. Everything else on the record stays
 *  trusted: `generator` is a def id resolved at reconfigure, and `params` is a
 *  def-specific bag the def's own param schema owns.
 *
 *  @throws {@link Error} if `entityId` or either `opSpan` end is not a
 *    non-negative integer, `seed` is not finite, `region` is not an object
 *    with finite three-number `min`/`max`, or `frozen`/`baked` is present and
 *    not literally `true`. */
function assertEntityNumbers(
  entity: Record<string, unknown>,
  id: number,
): void {
  assertLogId(entity["entityId"], "entity.entityId", id);
  const seed = entity["seed"];
  // Number.isFinite alone: false for a string, null, undefined and NaN, so a
  // `typeof` guard in front of it would be dead code (see isLogId).
  if (!Number.isFinite(seed))
    throw new Error(
      `field oplog: op ${id} entity.seed must be a finite number, got ${jsonTag(seed)}`,
    );
  const region = entity["region"];
  if (!isRecord(region))
    throw new Error(
      `field oplog: op ${id} entity.region must be an object, got ${typeTag(region)}`,
    );
  for (const bound of ["min", "max"] as const) {
    const v = numberArray(region[bound], 3, id, `entity.region.${bound}`);
    if (!v.every((n) => Number.isFinite(n)))
      throw new Error(
        `field oplog: op ${id} entity.region.${bound} must be three finite numbers`,
      );
  }
  const span = numberArray(entity["opSpan"], 2, id, "entity.opSpan");
  span.forEach((n, i) => assertLogId(n, `entity.opSpan[${i}]`, id));
  // The two literal-`true` flags. Not numbers, but they are the ONLY fields on
  // this record whose contract lives purely in the type system — `frozen?: true`
  // and `baked?: true` are spelled `true`-not-`boolean` so that ABSENCE is the
  // only way to say "no", which the boundary cast bypasses wholesale. Every
  // consumer tests `=== true` / `!== true`, so a wire `frozen: "yes"` reads as
  // NOT frozen and reconfigure runs on a record its own doc calls protected —
  // failing OPEN on a guard. Two lines here beat auditing every consumer.
  for (const flag of ["frozen", "baked"] as const) {
    const v = entity[flag];
    if (v !== undefined && v !== true)
      throw new Error(
        `field oplog: op ${id} entity.${flag} must be true or absent, got ${jsonTag(v)}`,
      );
  }
}

/** @throws {@link Error} if an entity op's `action` is off-contract, its
 *   `entity` is not a record, that record's `type` is off-contract, or its
 *   numeric interior is invalid ({@link assertEntityNumbers}). */
function assertEntityWire(raw: Record<string, unknown>, id: number): void {
  assertOneOf(raw["action"], ENTITY_ACTIONS, "action", id);
  const entity = raw["entity"];
  if (!isRecord(entity))
    throw new Error(`field oplog: entity op ${id} has no entity record`);
  assertOneOf(entity["type"], ENTITY_TYPES, "entity.type", id);
  assertEntityNumbers(entity, id);
}

/** Maps a pre-F2 dig literal (`kind:"dig"`, as F1 baked it) forward to a
 *  brush/dig op — `effect` is supplied here, so only the shape is read. The
 *  upgraded op runs the SAME value pass a native brush op does: an F1 bake is
 *  the oldest file on disk and therefore the likeliest to be bit-rotted.
 *
 *  @throws {@link Error} if it has no shape object, an off-contract
 *    `shape.kind`, or a shape whose numbers {@link assertOpStructure} rejects. */
function upgradeLegacyDig(raw: Record<string, unknown>, id: number): BrushOp {
  const shape = raw["shape"];
  assertShapeWire(shape, id, "legacy dig");
  // Boundary cast: `shape.kind` is a checked SHAPE_KINDS key and each vector
  // that member carries is a verified three-number array; assertOpStructure
  // below then rejects any of those numbers the engine will not accept.
  const op: BrushOp = {
    id,
    kind: "brush",
    effect: "dig",
    shape: shape as BrushShape,
  };
  atOp(id, () => assertOpStructure(op));
  return op;
}

/** @throws {@link Error} if the brush op fails its wire guards
 *   ({@link assertBrushWire}) or its numeric interior fails
 *   {@link assertOpStructure}. */
function decodeBrushOp(raw: Record<string, unknown>, id: number): BrushOp {
  assertBrushWire(raw, id);
  // Boundary cast: every closed STRING union this op carries has been checked —
  // `effect`, `shape.kind`, `mask.kind`, `mask.selection.kind`, `smooth.mode` —
  // and every fixed-length vector reachable from them is a verified array of
  // its declared length, which is what makes the numeric pass below meet
  // numbers rather than raise a TypeError inside a predicate.
  //
  // Those two clauses are exactly where this path is STRICTER than
  // `assertOpValid`, which takes an already-typed BrushOp and so re-checks
  // neither. Measured, `assertOpValid` accepts and this rejects: a `smooth`
  // block on a non-smooth op (bad `mode`, or not a record at all — the params
  // BEHIND it stay unchecked there, deliberately, see assertSmoothWire); a
  // `center`/`halfExtents`/capsule endpoint of length 2 or 4, where the
  // predicate's `.every(isFinite)` passes a short array; a region mask's
  // `min`/`max` of the wrong length, for the same reason; plus the union tags
  // and the op `id` itself. All one-directional — nothing the commit path
  // rejects is accepted here.
  const op = raw as BrushOp;
  atOp(id, () => assertOpStructure(op));
  return op;
}

/** @throws {@link Error} if the entity op fails its wire guards
 *   ({@link assertEntityWire}, which includes the record's numeric
 *   interior). */
function decodeEntityOp(raw: Record<string, unknown>, id: number): EntityOp {
  assertEntityWire(raw, id);
  // Boundary cast: `action` and `entity.type` are checked union members; the
  // entity record's every number, AND its two literal-`true` flags
  // (`frozen`/`baked` — the fields whose contract only the type system carries),
  // have been checked by assertEntityNumbers. What stays trusted is `generator`
  // (a def id, resolved at reconfigure) and `params` (a def-specific bag,
  // validated by the def's own param schema).
  return raw as EntityOp;
}

/** One op from either envelope version — `kind:"dig"` is a v1 spelling, but
 *  accepting it in a v2 envelope too keeps ONE decode path.
 *
 *  @throws {@link Error} if the op is not an object, has no integer `id`, or
 *    fails its kind's wire guards. */
function decodeOp(raw: unknown): FieldOp {
  if (!isRecord(raw))
    throw new Error(
      `field oplog: every op must be a JSON object, got ${typeTag(raw)}`,
    );
  const id = raw["id"];
  // Every kind needs this, so it is checked ONCE, before the dispatch. Without
  // it the editor's `ops.reduce((max, o) => Math.max(max, o.id), 0) + 1` yields
  // NaN, every op authored afterwards is stamped `id: NaN`, and JSON.stringify
  // writes those back to disk as `null` — a corrupt log made plausible.
  //
  // NON-NEGATIVE, not merely integer: this is the same quantity assertLogId
  // guards for an entity's `entityId`/`opSpan`, and the two disagreeing meant a
  // negative `opSpan` end was rejected while `{"id": -5}` LOADED. It is also
  // this file's op LOCATOR, so it cannot be checked by assertLogId itself —
  // hence the shared isLogId predicate and a message of its own.
  if (!isLogId(id))
    throw new Error(
      `field oplog: op id must be a non-negative integer, got ${jsonTag(id)}`,
    );
  const kind = raw["kind"];
  if (kind === "patch") return decodePatchOp(raw, id);
  if (kind === "placement") return decodePlacementOp(raw, id);
  if (kind === "dig") return upgradeLegacyDig(raw, id);
  if (kind === "brush") return decodeBrushOp(raw, id);
  if (kind === "entity") return decodeEntityOp(raw, id);
  throw new Error(`field oplog: op of unknown kind ${jsonTag(kind)}`);
}

/** Distinguishes a FUTURE oplog (a later furnace wrote it) from an
 *  unrecognised one (corrupt, or not an oplog at all). */
function versionError(version: unknown): Error {
  if (typeof version === "number" && version > OPLOG_VERSION)
    return new Error(
      `field oplog: version ${version} is newer than this build (max ${OPLOG_VERSION})`,
    );
  // jsonTag, not String(): a STRING "2" must not report `unknown version 2`,
  // which reads as "2 is unknown" when 2 is the supported version.
  return new Error(`field oplog: unknown version ${jsonTag(version)}`);
}

/** `JSON.parse` with this module's locator on the failure — the field load path
 *  reads `manifest.json`, `oplog.json` and `kit/*.json` beside each other, and a
 *  bare "JSON Parse error" says nothing about which one broke.
 *
 *  @throws {@link Error} if `text` is not valid JSON. */
function parseOplogJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`field oplog: not valid JSON — ${detail}`);
  }
}

/**
 * Parses an oplog back into the op list. Reads the v2 AND v3 envelopes
 * {@link serializeOps} writes (v3 adds placement ops; a v2 file carries none)
 * and a v1 BARE array (an F1/F2 bake), including F1's `kind:"dig"` literals,
 * which map forward to brush/dig ops. The two forms are unambiguous: a JSON
 * array is never a JSON object.
 *
 * Setup-loud on an unreadable log — a corrupt oplog must never become a
 * plausible-looking one.
 *
 * This is a SECURITY BOUNDARY, not a robustness nicety, and the framing is what
 * sets the bar: an oplog is no longer only something this machine wrote. A
 * shared world, or a log an agent authored, arrives as untrusted bytes and
 * leaves here as typed engine objects that nothing downstream re-examines —
 * loaded ops are pushed straight into `log.ops`, never pass through
 * {@link logApply}/{@link logApplyPatch}, and {@link applyOp}/
 * {@link applyPatchOp} trust their input by contract. Every check that is going
 * to happen happens here.
 *
 * WHAT IS CHECKED — the envelope's shape and version; that every op is an
 * object carrying an INTEGER `id` and a known `kind`; EVERY closed STRING union
 * that reaches the wire — a brush's `effect`, `shape.kind`, `mask.kind` and an
 * embedded `mask.selection.kind`, its `smooth.mode`, an entity's `action` and
 * `entity.type`; that an entity op carries a record and that a present optional
 * `mask`/`smooth` is one; EVERY NUMERIC field a brush op carries, by running
 * the engine's own {@link assertOpStructure} — the table-INDEPENDENT half of
 * {@link assertOpValid}, a subset of it by construction, so an op the EDITOR
 * could commit can never fail to load (this function is otherwise deliberately
 * STRICTER than `assertOpValid`, which is typed and therefore re-checks no
 * union tag and no vector LENGTH — see {@link assertOpStructure}); every
 * numeric field of an entity record ({@link assertEntityNumbers} — the record
 * has no commit-path validator to borrow, so this is the only guard it gets);
 * for patch ops, the full table-independent structure
 * ({@link assertPatchStructure} — canonical unique chunk keys, 512-byte masks,
 * value arrays exactly as long as their mask's popcount), so a truncated or
 * garbage base64 payload is rejected rather than mis-applied; and, for placement
 * ops, each record's shape ({@link PlacementRecord} fields) AND values
 * ({@link assertPlacementsValid} — finite vectors, unit quat, non-negative
 * integer variant).
 *
 * WHAT IS NOT — whether a class id NAMES A CLASS. A brush's `material`, a
 * `mask.classId`, a flood-material spec's `classId` and a patch slice's material
 * bytes are all checked to be ids the material channel can store, which is the
 * whole of the table-independent question; resolving them needs a
 * {@link MaterialTable}, and this function takes none. The load path HAS one to
 * hand — `FieldManifest.materialTable` is embedded in every v2 manifest — so
 * closing it is a signature question, not a knowledge one. An unresolvable class
 * id therefore still surfaces late, at mesh time.
 *
 * @param text - the oplog file's contents.
 * @returns freshly built ops; no input buffer is aliased.
 * @throws {@link Error} on invalid JSON, a non-array non-object payload, an
 *   unknown or future envelope version, an envelope with no `ops` array, an
 *   op with a non-integer `id`, an unknown `kind`, an off-contract union field,
 *   a vector that is not an array of the right length, an entity record whose
 *   numbers are invalid, a brush op whose numbers {@link assertOpStructure}
 *   rejects, a patch op whose payload does not decode to a structurally valid
 *   patch, or a placement op whose records are malformed. Messages this file
 *   raises itself carry the `field oplog:` prefix. A wired engine predicate
 *   keeps its own prefix (`field op:`, `field selection:`, `field patch:`,
 *   `field placement:`) and is re-thrown behind this file's op locator —
 *   `field oplog: op <id> — <the predicate's message>` (see {@link atOp}), with
 *   the original on `cause`.
 */
export function parseOps(text: string): FieldOp[] {
  const parsed = parseOplogJson(text);
  if (Array.isArray(parsed)) return parsed.map(decodeOp); // v1 bare array
  if (!isRecord(parsed))
    throw new Error(
      `field oplog: expected a versioned envelope or a v1 op array, got ${typeTag(parsed)}`,
    );
  const version = parsed["version"];
  // Every envelope version this build reads: v2 (patches) and v3 (placements).
  // A v2 file simply carries no placement ops. versionError distinguishes a
  // FUTURE version (> OPLOG_VERSION) from a corrupt/unknown one.
  if (version !== 2 && version !== 3) throw versionError(version);
  const ops = parsed["ops"];
  if (!Array.isArray(ops))
    throw new Error("field oplog: envelope has no ops array");
  return ops.map(decodeOp);
}

// ─── placement artifact (F3b: D-F3-10) ───

/** Floats per packed placement record: `pos3 + quat4 + scale3 + variant1`. The
 *  archetype id is the GROUP key — never in the float array — mirroring the
 *  packed per-archetype instance-buffer shape (Unity TreeInstance / Godot
 *  MultiMesh). Distinct from {@link packPlacementMatrices}' 16-float render
 *  matrix: this is the SERIALIZED record the loader re-packs into matrices. */
const PLACEMENT_FLOATS = 11;
const F32_BYTES = 4;

/** Placement-artifact envelope version. Independent of the oplog and manifest
 *  versions — the placement artifact is its own file. */
const PLACEMENT_ARTIFACT_VERSION = 1;

/** One archetype's decoded placement group: the archetype id and its records
 *  (each reconstructed with `archetypeId` set to the group id). */
export type PlacementGroup = { id: string; records: PlacementRecord[] };

/** Groups records by archetype id in FIRST-APPEARANCE order (a Map preserves
 *  insertion order), each group keeping its records' relative order — so a
 *  round-trip is stable and archetype-contiguous input survives unreordered. */
function groupByArchetype(
  records: readonly PlacementRecord[],
): Map<string, PlacementRecord[]> {
  const groups = new Map<string, PlacementRecord[]>();
  for (const r of records) {
    const g = groups.get(r.archetypeId);
    if (g === undefined) groups.set(r.archetypeId, [r]);
    else g.push(r);
  }
  return groups;
}

/** Packs one archetype's records into a flat Float32Array, {@link
 *  PLACEMENT_FLOATS} per record in the fixed
 *  `[px,py,pz, qx,qy,qz,qw, sx,sy,sz, variantIndex]` order. */
function packPlacementFloats(
  records: readonly PlacementRecord[],
): Float32Array {
  const out = new Float32Array(PLACEMENT_FLOATS * records.length);
  records.forEach((r, i) => {
    const o = i * PLACEMENT_FLOATS;
    out[o] = r.position[0];
    out[o + 1] = r.position[1];
    out[o + 2] = r.position[2];
    out[o + 3] = r.quat[0];
    out[o + 4] = r.quat[1];
    out[o + 5] = r.quat[2];
    out[o + 6] = r.quat[3];
    out[o + 7] = r.scale[0];
    out[o + 8] = r.scale[1];
    out[o + 9] = r.scale[2];
    out[o + 10] = r.variantIndex;
  });
  return out;
}

/**
 * Serializes explicit placement records as the placement artifact (D-F3-10):
 * `{ version: 1, archetypes: [{ id, count, records }] }`, where `records` is a
 * base64 Float32Array packed {@link PLACEMENT_FLOATS} floats per record. Records
 * are grouped per archetype — the packed per-archetype instance-buffer shape the
 * loader re-packs into render matrices with {@link packPlacementMatrices}. No
 * collider data, no clustering (both derived at load).
 *
 * @param records - the placement records (any order; grouped here by archetype).
 * @returns the `placements.json` text.
 */
export function serializePlacements(
  records: readonly PlacementRecord[],
): string {
  const archetypes = Array.from(groupByArchetype(records), ([id, group]) => {
    const floats = packPlacementFloats(group);
    return {
      id,
      count: group.length,
      records: u8ToB64(
        new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength),
      ),
    };
  });
  return JSON.stringify({ version: PLACEMENT_ARTIFACT_VERSION, archetypes });
}

/** `JSON.parse` with this module's locator on failure — a placement artifact
 *  sits beside `manifest.json`/`oplog.json` in a world dir.
 *
 *  @throws {@link Error} if `text` is not valid JSON. */
function parsePlacementJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`field placements: not valid JSON — ${detail}`);
  }
}

/** Reconstructs one archetype's records from its base64 float payload, keying
 *  every record's `archetypeId` to the group id.
 *
 *  @throws {@link Error} if the payload is not `count · PLACEMENT_FLOATS · 4`
 *    bytes. */
function decodePlacementFloats(
  bytes: Uint8Array,
  id: string,
  count: number,
): PlacementRecord[] {
  const expected = count * PLACEMENT_FLOATS * F32_BYTES;
  if (bytes.byteLength !== expected)
    throw new Error(
      `field placements: archetype "${id}" records is ${bytes.byteLength} bytes, expected ${expected} (${count} × ${PLACEMENT_FLOATS} × ${F32_BYTES})`,
    );
  // b64ToU8 returns a fresh, offset-0, exact-sized buffer, so this Float32 view
  // is aligned; the length check above proves every index below is in-bounds, so
  // the `as number` sheds noUncheckedIndexedAccess widening (decodeMaterialFile
  // precedent, same file).
  const f = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    count * PLACEMENT_FLOATS,
  );
  const records: PlacementRecord[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * PLACEMENT_FLOATS;
    records.push({
      archetypeId: id,
      position: [f[o] as number, f[o + 1] as number, f[o + 2] as number],
      quat: [
        f[o + 3] as number,
        f[o + 4] as number,
        f[o + 5] as number,
        f[o + 6] as number,
      ],
      scale: [f[o + 7] as number, f[o + 8] as number, f[o + 9] as number],
      variantIndex: f[o + 10] as number,
    });
  }
  return records;
}

/** @throws {@link Error} if the group is not an object, its `id` is not a
 *   non-empty string, its `count` is not a non-negative integer, its `records`
 *   is not a base64 string, or the payload length disagrees with `count`. */
function decodePlacementGroup(raw: unknown): PlacementGroup {
  if (!isRecord(raw))
    throw new Error(
      "field placements: an archetype group is not a JSON object",
    );
  const id = raw["id"];
  if (typeof id !== "string" || id.length === 0)
    throw new Error(
      "field placements: archetype id must be a non-empty string",
    );
  const count = raw["count"];
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0)
    throw new Error(
      `field placements: archetype "${id}" count must be a non-negative integer, got ${jsonTag(count)}`,
    );
  const recordsB64 = raw["records"];
  if (typeof recordsB64 !== "string")
    throw new Error(
      `field placements: archetype "${id}" records must be a base64 string`,
    );
  let bytes: Uint8Array;
  try {
    bytes = b64ToU8(recordsB64);
  } catch {
    throw new Error(
      `field placements: archetype "${id}" records is not valid base64`,
    );
  }
  return { id, records: decodePlacementFloats(bytes, id, count) };
}

/**
 * Parses a placement artifact ({@link serializePlacements}) back into per-archetype
 * groups. Setup-loud (a file the process did not write): the envelope shape and
 * version are checked, every group's `id`/`count`/`records` shape is checked, the
 * float payload's length must match `count`, and each group's reconstructed
 * records are value-validated with {@link assertPlacementsValid} (finite vectors,
 * unit quat, non-negative integer variant) — a corrupt artifact never becomes a
 * plausible one.
 *
 * @param text - the `placements.json` contents.
 * @returns per-archetype groups in first-appearance order; no input aliased.
 * @throws {@link Error} on invalid JSON, a non-object payload, an unknown
 *   version, a missing/`non-array` `archetypes`, a malformed group, a payload
 *   whose length disagrees with `count`, or records that fail
 *   {@link assertPlacementsValid}.
 */
export function parsePlacements(text: string): PlacementGroup[] {
  const parsed = parsePlacementJson(text);
  if (!isRecord(parsed))
    throw new Error(
      `field placements: expected a versioned envelope, got ${typeTag(parsed)}`,
    );
  if (parsed["version"] !== PLACEMENT_ARTIFACT_VERSION)
    throw new Error(
      `field placements: unknown version ${jsonTag(parsed["version"])}`,
    );
  const archetypes = parsed["archetypes"];
  if (!Array.isArray(archetypes))
    throw new Error("field placements: envelope has no archetypes array");
  const groups = archetypes.map(decodePlacementGroup);
  for (const g of groups) assertPlacementsValid(g.records);
  return groups;
}

/** File-name-safe key segment ("cx,cy,cz" → "cx_cy_cz"). */
const keyToFileName = (key: ChunkKey): string => key.replaceAll(",", "_");

/** World-dir-relative density-file path for a chunk ("chunks/cx_cy_cz.bin"). */
const chunkRelPath = (key: ChunkKey): string =>
  `chunks/${keyToFileName(key)}.bin`;

/** World-dir-relative render-mesh path for one per-class bucket
 *  ("meshes/cx_cy_cz.c<classId>[b].fmesh"; a `b` suffix marks a kit BACKING
 *  bucket, e.g. `0_0_0.c2b.fmesh`). Unique per (chunk, classId, backing); the
 *  manifest entry carries the authoritative classId/backing — the name is for
 *  human legibility only. */
const meshRelPath = (
  key: ChunkKey,
  classId: number,
  backing: boolean,
): string =>
  `meshes/${keyToFileName(key)}.c${classId}${backing ? "b" : ""}.fmesh`;

/** World-dir-relative material-sibling path ("materials/cx_cy_cz.mat"). */
const materialRelPath = (key: ChunkKey): string =>
  `materials/${keyToFileName(key)}.mat`;

/** World-dir-relative kit-instance path ("kit/cx_cy_cz.json"). */
const kitRelPath = (key: ChunkKey): string => `kit/${keyToFileName(key)}.json`;

/** True when a chunk's material storage is a real non-rock presence — anything
 *  other than the uniform-{@link MAT_ROCK} default every untracked chunk already
 *  implies. Only these chunks get a baked `.mat` sibling. */
const hasMaterialPresence = (
  m: ChunkMaterials | undefined,
): m is ChunkMaterials =>
  m !== undefined && !(m.kind === "uniform" && m.classId === MAT_ROCK);

/** Full baked path of a chunk's density file ("worlds/<name>/chunks/…"). */
export const chunkFilePath = (name: string, key: ChunkKey): string =>
  `worlds/${name}/${chunkRelPath(key)}`;

/** Options for {@link bakeFieldWorld}. */
export type BakeFieldWorldOptions = {
  name: string;
  playerStart: [number, number, number];
  playerYaw: number;
};

/**
 * Bakes the full v0 artifact for a field world: a v2 manifest + one per-chunk
 * density file (authoring truth) + the oplog JSON + one `.fmesh` render mesh per
 * NON-EMPTY per-class bucket (the derived runtime bake) + a `.mat` material
 * sibling for every chunk with a real non-rock material + a `kit/*.json` for
 * every chunk holding kit pieces + a `placements.json` placement artifact when
 * the log carries any placement ops (D-F3-10). The resolved `table` is embedded
 * in the manifest so the artifact is self-contained.
 *
 * Pure — returns the file set; the caller owns writing/uploading. The manifest
 * is emitted LAST so a partial write never yields a manifest referencing files
 * that were not written. Manifest `*.file` fields are relative to the world dir;
 * the returned `path`s are the full baked paths.
 *
 * @param store - the field store to bake.
 * @param log - the op log (authoring truth, serialized to `oplog.json`).
 * @param table - the resolved material table. The mesher + skinner dispatch on
 *   class via {@link classOf}, which THROWS on a class id absent from the table,
 *   so it MUST cover every material the store references.
 * @param opts - world name + runtime spawn pose.
 * @throws {@link Error} if the store references a class id absent from `table`.
 */
export function bakeFieldWorld(
  store: FieldStore,
  log: OpLog,
  table: MaterialTable,
  opts: BakeFieldWorldOptions,
): BakedFile[] {
  const files: BakedFile[] = [];
  const materials: { key: ChunkKey; file: string }[] = [];
  const kit: { key: ChunkKey; file: string }[] = [];
  const manifest: FieldManifest = {
    version: 2,
    kind: "field",
    cellSize: store.cellSize,
    playerStart: opts.playerStart,
    playerYaw: opts.playerYaw,
    chunks: [],
    meshes: [],
    materialTable: table,
  };

  for (const [key, chunk] of store.chunks) {
    manifest.chunks.push({ key, file: chunkRelPath(key) });
    files.push({
      path: chunkFilePath(opts.name, key),
      contents: encodeChunkFile(chunk),
    });

    const mat = store.materials.get(key);
    if (hasMaterialPresence(mat)) {
      const matFile = materialRelPath(key);
      materials.push({ key, file: matFile });
      files.push({
        path: `worlds/${opts.name}/${matFile}`,
        contents: encodeMaterialFile(mat),
      });
    }

    const aprons = extractFieldAprons(store, key);
    const [cx, cy, cz] = parseChunkKey(key);
    const origin: [number, number, number] = [
      cx * CHUNK_DIM * store.cellSize,
      cy * CHUNK_DIM * store.cellSize,
      cz * CHUNK_DIM * store.cellSize,
    ];
    for (const bucket of meshChunkField(aprons, table, store.cellSize)
      .buckets) {
      if (bucket.mesh.indices.length === 0) continue;
      const meshFile = meshRelPath(key, bucket.classId, bucket.backing);
      manifest.meshes.push({
        key,
        file: meshFile,
        origin,
        classId: bucket.classId,
        backing: bucket.backing,
      });
      files.push({
        path: `worlds/${opts.name}/${meshFile}`,
        contents: new Uint8Array(encodeMeshBlob({ render: bucket.mesh })),
      });
    }

    const pieces = skinChunkKit(aprons, table, store.cellSize, key);
    if (pieces.length > 0) {
      const kitFile = kitRelPath(key);
      kit.push({ key, file: kitFile });
      files.push({
        path: `worlds/${opts.name}/${kitFile}`,
        contents: JSON.stringify(pieces),
      });
    }
  }

  if (materials.length > 0) manifest.materials = materials;
  if (kit.length > 0) manifest.kit = kit;

  // Placement artifact (D-F3-10): every PlacementOp still in log.ops (splice
  // semantics already removed undone ones), folded in order into one grouped
  // per-archetype file. Additive — the manifest field is absent when empty.
  const placementRecords = log.ops
    .filter((op): op is PlacementOp => op.kind === "placement")
    .flatMap((op) => op.records);
  if (placementRecords.length > 0) {
    manifest.placements = "placements.json";
    files.push({
      path: `worlds/${opts.name}/placements.json`,
      contents: serializePlacements(placementRecords),
    });
  }

  files.push({
    path: `worlds/${opts.name}/oplog.json`,
    contents: serializeOps(log.ops),
  });
  files.push({
    path: `worlds/${opts.name}/manifest.json`,
    contents: JSON.stringify(manifest, null, 2),
  });
  return files;
}
