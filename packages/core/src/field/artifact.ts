import { encodeMeshBlob } from "@furnace/core/scene";
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  extractFieldAprons,
  parseChunkKey,
} from "./chunks.ts";
import { meshChunkField } from "./mesher.ts";
import { assertPatchStructure } from "./ops.ts";
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
 *  still read; v2 wraps the list so patch ops can carry base64 payloads. */
const OPLOG_VERSION = 2;

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
 * Serializes the op list (the authoring truth — brush, entity AND patch ops) as
 * a v2 envelope: `{ version, ops }`, with each patch slice's typed arrays as
 * base64 strings. Plain `JSON.stringify` would render them as index-keyed
 * objects (`{"0":…}`) — ~8× the bytes, and no longer typed arrays on the way
 * back.
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
 *   patch fails {@link assertPatchStructure}. */
function decodePatchOp(raw: Record<string, unknown>, id: number): PatchOp {
  const chunks = raw["chunks"];
  if (!Array.isArray(chunks))
    throw new Error(`field oplog: patch op ${id} has no chunks array`);
  const op: PatchOp = {
    id,
    kind: "patch",
    chunks: chunks.map(decodePatchChunk),
  };
  assertPatchStructure(op);
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

/** The mask leg: its own discriminator, plus an embedded selection's. Class ids
 *  (`mask.classId`, `selection.classId`) need a MaterialTable and stay
 *  unchecked — the DISCRIMINATORS do not.
 *
 *  @throws {@link Error} if `mask` is present and not a record, its `kind` is
 *    off-contract, or a selection mask's `selection` is absent/off-contract. */
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
}

/** The smooth leg — its `mode` only. `strength`/`iterations` are numeric and
 *  stay unchecked here (see {@link parseOps}).
 *
 *  @throws {@link Error} if `smooth` is present and not a record, or its `mode`
 *    is off-contract. */
function assertSmoothWire(raw: Record<string, unknown>, id: number): void {
  const smooth = optionalRecord(raw, "smooth", id);
  if (smooth === undefined) return;
  assertOneOf(smooth["mode"], SMOOTH_MODES, "smooth.mode", id);
}

/** The shape leg shared by a brush op and the legacy-dig upgrade; `kindLabel`
 *  names which for the message.
 *
 *  @throws {@link Error} if the shape is absent or its `kind` is off-contract. */
function assertShapeWire(
  shape: unknown,
  id: number,
  kindLabel: "brush" | "legacy dig",
): void {
  if (!isRecord(shape))
    throw new Error(`field oplog: ${kindLabel} op ${id} has no shape object`);
  assertOneOf(shape["kind"], SHAPE_KINDS, "shape.kind", id);
}

/** @throws {@link Error} if a brush op's `effect` or `shape.kind` is
 *   off-contract, it carries no shape object, or its OPTIONAL `mask`/`smooth`
 *   legs are off-contract. */
function assertBrushWire(raw: Record<string, unknown>, id: number): void {
  assertOneOf(raw["effect"], BRUSH_EFFECTS, "effect", id);
  assertShapeWire(raw["shape"], id, "brush");
  assertMaskWire(raw, id);
  assertSmoothWire(raw, id);
}

/** @throws {@link Error} if an entity op's `action` is off-contract, its
 *   `entity` is not a record, or that record's `type` is off-contract. */
function assertEntityWire(raw: Record<string, unknown>, id: number): void {
  assertOneOf(raw["action"], ENTITY_ACTIONS, "action", id);
  const entity = raw["entity"];
  if (!isRecord(entity))
    throw new Error(`field oplog: entity op ${id} has no entity record`);
  assertOneOf(entity["type"], ENTITY_TYPES, "entity.type", id);
}

/** Maps a pre-F2 dig literal (`kind:"dig"`, as F1 baked it) forward to a
 *  brush/dig op — `effect` is supplied here, so only the shape is read.
 *
 *  @throws {@link Error} if it has no shape object or an off-contract
 *    `shape.kind`. */
function upgradeLegacyDig(raw: Record<string, unknown>, id: number): BrushOp {
  const shape = raw["shape"];
  assertShapeWire(shape, id, "legacy dig");
  // Boundary cast: `shape.kind` is checked above; its NUMERIC interior is not —
  // see {@link parseOps} for what stays trusted and why.
  return { id, kind: "brush", effect: "dig", shape: shape as BrushShape };
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
  if (typeof id !== "number" || !Number.isInteger(id))
    throw new Error(
      `field oplog: op id must be an integer, got ${jsonTag(id)}`,
    );
  const kind = raw["kind"];
  if (kind === "patch") return decodePatchOp(raw, id);
  if (kind === "dig") return upgradeLegacyDig(raw, id);
  if (kind === "brush") assertBrushWire(raw, id);
  else if (kind === "entity") assertEntityWire(raw, id);
  else throw new Error(`field oplog: op of unknown kind ${jsonTag(kind)}`);
  // Boundary cast: every closed STRING union on the wire has now been checked —
  // the op's `kind` and integer `id`, a brush's `effect`, `shape.kind`,
  // `mask.kind` and `mask.selection.kind`, its `smooth.mode`, an entity's
  // `action` and `entity.type`. What stays trusted is every NUMERIC field
  // (shape centres/radii/extents, `mask.classId`, `smooth.strength`/
  // `iterations`, a flood's `seed`/`budget`, the entity record's `entityId`/
  // `seed`/`region`/`opSpan`) — see {@link parseOps} for which of those need a
  // MaterialTable and which are simply deferred.
  return raw as FieldOp;
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
 * Parses an oplog back into the op list. Reads BOTH the v2 envelope
 * {@link serializeOps} writes and a v1 BARE array (an F1/F2 bake), including
 * F1's `kind:"dig"` literals, which map forward to brush/dig ops. The two are
 * unambiguous: a JSON array is never a JSON object.
 *
 * Setup-loud on an unreadable log — a corrupt oplog must never become a
 * plausible-looking one.
 *
 * WHAT IS CHECKED — the envelope's shape and version; that every op is an
 * object carrying an INTEGER `id` and a known `kind`; EVERY closed STRING union
 * that reaches the wire — a brush's `effect`, `shape.kind`, `mask.kind` and an
 * embedded `mask.selection.kind`, its `smooth.mode`, an entity's `action` and
 * `entity.type`; that an entity op carries a record and that a present optional
 * `mask`/`smooth` is one; and, for patch ops, the full table-independent
 * structure ({@link assertPatchStructure} — canonical unique chunk keys,
 * 512-byte masks, value arrays exactly as long as their mask's popcount), so a
 * truncated or garbage base64 payload is rejected rather than mis-applied.
 *
 * WHAT IS NOT — every NUMERIC field: a shape's centre/radius/half-extents, a
 * brush's `material` and `mask.classId`, `smooth.strength`/`iterations`, a
 * flood selection's `seed`/`budget`, an entity record's
 * `entityId`/`seed`/`region`/`opSpan`, and a patch slice's material class ids.
 * Some of those need a {@link MaterialTable} (the class ids), which this
 * function does not take; the rest are simply deferred — note that
 * `assertSmoothValid` and {@link assertSelectionSpecValid} already own the right
 * predicates and are merely not wired to this path.
 *
 * Nothing downstream re-checks any of it: loaded ops are pushed straight into
 * `log.ops` and never pass through {@link logApply}/{@link logApplyPatch}, and
 * {@link applyOp}/{@link applyPatchOp} trust their input by contract. A bad
 * class id therefore surfaces late, at mesh time.
 *
 * @param text - the oplog file's contents.
 * @returns freshly built ops; no input buffer is aliased.
 * @throws {@link Error} on invalid JSON, a non-array non-object payload, an
 *   unknown or future envelope version, a v2 envelope with no `ops` array, an
 *   op with a non-integer `id`, an unknown `kind` or an off-contract union
 *   field, or a patch op whose payload does not decode to a structurally valid
 *   patch (those messages carry the `field patch:` prefix).
 */
export function parseOps(text: string): FieldOp[] {
  const parsed = parseOplogJson(text);
  if (Array.isArray(parsed)) return parsed.map(decodeOp); // v1 bare array
  if (!isRecord(parsed))
    throw new Error(
      `field oplog: expected a v2 envelope or a v1 op array, got ${typeTag(parsed)}`,
    );
  const version = parsed["version"];
  if (version !== OPLOG_VERSION) throw versionError(version);
  const ops = parsed["ops"];
  if (!Array.isArray(ops))
    throw new Error("field oplog: v2 envelope has no ops array");
  return ops.map(decodeOp);
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
 * every chunk holding kit pieces. The resolved `table` is embedded in the
 * manifest so the artifact is self-contained.
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
