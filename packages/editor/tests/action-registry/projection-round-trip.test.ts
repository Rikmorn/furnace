// ADVERTISEMENT EQUALS VALIDATION — one contract, two spellings, held to the same verdict.
//
// THERE ARE TWO SPELLINGS OF WHAT AN ACTION TAKES AND ONLY ONE OF THEM IS ENFORCED.
// `dispatch` parses a caller's arguments with the zod schema in `src/action-registry/
// schemas.ts`; an agent reads the JSON Schema `toJsonSchema` reflects out of that same object
// and decides what to SEND from that. Nothing has ever checked the two say the same thing,
// because until this file nothing called `toJsonSchema` on an action at all — its one
// production caller is the field generator registry (`packages/core/src/field/registry.ts:86`),
// which reflects generator params and never touches these six rows. This file is the check,
// and it is the first action caller.
//
// WHAT IT COMPARES IS VERDICTS, NOT SHAPES, and that is the whole design rather than a
// stylistic preference. A case asserting that the reflected document LOOKS like the zod schema
// would be a MIRROR: it re-derives one side from the other and then agrees with itself, and it
// would keep agreeing while both drifted together. So `admits()` below READS the advertised
// document the way a client would — root `type`, `required`, each property's `type` and its
// bounds — and its answer for a sample must equal `schema.safeParse(sample).success` for the
// same sample. Two independent readers, one question, one answer. Every sample is run against
// every row, so no row is graded only on arguments tailored to it: `{entityId: 7}` must be
// refused by `world.saveAs` for the same reason `{name: "moonlit"}` is refused by
// `edit.duplicate`, and both refusals have to show up on both sides.
//
// THE COMPLETENESS CLAUSE IS WHAT KEEPS THAT HONEST. `admits` reads a FIXED keyword set, so on
// its own it could quietly become a partial reader: a row gaining `.min(1)`, `.enum([…])` or a
// switch to `z.strictObject` would advertise a constraint this file does not interpret, and the
// agreement case would keep passing by ignoring the new keyword — agreement bought by reading
// less. The second case below forbids that: every keyword the six documents actually carry must
// be one this file interprets, so a new constraint reds HERE and forces the reader to grow
// before the pin is trusted again. `admitsField` throws rather than returning `false` on a type
// it cannot read, for the same reason — a silent `false` would look like a refusal the
// advertisement made.
//
// `io: "input"` IS THE RIGHT VIEW AND THE CHOICE IS FREE TODAY. The TSDoc at
// `packages/core/src/registry/registry.ts:44-52` states the split: `"output"` keeps a
// defaulted field required, `"input"` is the AUTHORING view where a defaulted field is
// omittable. The caller here is authoring an argument object, so `"input"`
// is the honest one — and no row carries a `.default()` today, so the two modes coincide and
// naming the right one costs nothing now and stops a defaulted field ever being advertised as
// required later.
//
// THE ONE PLACE THE TWO SIDES DIVERGE, stated because a pin that hid it would be worth less
// than none: an UNDECLARED key. `z.object` (not `strictObject`) STRIPS unknown keys, and the
// reflected document carries no `additionalProperties` at all — so both ADMIT the value and the
// verdict this file compares agrees, while what comes out the other side differs (zod's parsed
// data has the stray key removed; the advertisement never said it would be). That is a
// divergence in the OUTPUT, not in what goes in, and the samples below pin the admitting half
// explicitly rather than leaving it to be discovered. The day a row goes `strictObject` the
// completeness case reds on `additionalProperties`, which is the intended door.
//
// SAMPLES ARE WIRE-SHAPED ONLY — everything below is expressible in JSON. `{name: undefined}`
// is deliberately absent: `undefined` has no JSON encoding, so no MCP caller can send it, and a
// probe the wire cannot carry would be grading this file rather than the contract.
//
// NOTHING IS PROJECTED YET. These six schemas advertise nothing to anyone today —
// `daemon/mcp.ts` projects three daemon COMMANDS with a hand-written `NO_ARGUMENTS` document
// and imports this directory not at all (verified at T4b Task 6: `grep -rn "action-registry"
// src/daemon/` is empty). This is the plumbing pin that lands BEFORE the projection, so the
// projection cannot be the thing that discovers the two representations disagree.
import { expect, test } from "bun:test";
import { type JsonSchema, toJsonSchema } from "@furnace/core/registry";
import { ACTION_INPUT_SCHEMAS } from "../../src/action-registry/schemas.ts";

/** A JSON object, which is what root `type: "object"` admits — and not null, and not an
 *  array. A predicate rather than a cast: the narrowing is a real runtime check, so nothing
 *  here has to bypass the compiler to read an untyped document. */
const isJsonObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `required`, read defensively: absent means "nothing is required", which is what a client
 *  would conclude. Non-string members are dropped rather than trusted. */
const requiredOf = (doc: JsonSchema): string[] => {
  const required = doc["required"];
  if (!Array.isArray(required)) return [];
  return required.filter((k): k is string => typeof k === "string");
};

/** `properties`, same posture: absent means the document constrains no field by name. */
const fieldsOf = (doc: JsonSchema): Record<string, JsonSchema> => {
  const properties = doc["properties"];
  if (!isJsonObject(properties)) return {};
  return Object.fromEntries(
    Object.entries(properties).filter((entry): entry is [string, JsonSchema] =>
      isJsonObject(entry[1]),
    ),
  );
};

/** `minimum`/`maximum` when the document states them. zod reflects `.int()` as an `integer`
 *  bounded by ±`Number.MAX_SAFE_INTEGER`, which is a REAL constraint — one sample below is an
 *  integer that clears every other check and is refused by this alone, so the bounds are
 *  load-bearing and not decoration. */
const withinBounds = (field: JsonSchema, value: number): boolean => {
  const min = field["minimum"];
  const max = field["maximum"];
  const aboveFloor = typeof min !== "number" || value >= min;
  const belowCeiling = typeof max !== "number" || value <= max;
  return aboveFloor && belowCeiling;
};

/** The advertised primitive types this file knows how to interpret. */
const READERS: Record<string, (v: unknown, field: JsonSchema) => boolean> = {
  string: (v) => typeof v === "string",
  integer: (v, field) =>
    typeof v === "number" && Number.isInteger(v) && withinBounds(field, v),
};

const admitsField = (field: JsonSchema, value: unknown): boolean => {
  const type = field["type"];
  const reader = typeof type === "string" ? READERS[type] : undefined;
  // LOUD, not `false`. A type this file cannot read is a gap in the READER, and a silent
  // refusal would be indistinguishable from a refusal the advertisement made — the exact
  // false agreement the completeness case below exists to prevent.
  if (reader === undefined)
    throw new Error(
      `this reader cannot interpret the advertised type ${JSON.stringify(type)} — teach it, or the agreement below is bought by reading less`,
    );
  return reader(value, field);
};

/** Would a client that read ONLY this document send `value`? The independent half of the
 *  comparison: it never touches the zod schema the document came from. */
const admits = (doc: JsonSchema, value: unknown): boolean => {
  if (doc["type"] !== "object") return false;
  if (!isJsonObject(value)) return false;
  const everyRequiredKeyPresent = requiredOf(doc).every((k) => k in value);
  const everyDeclaredKeyWellTyped = Object.entries(fieldsOf(doc)).every(
    ([key, field]) => !(key in value) || admitsField(field, value[key]),
  );
  return everyRequiredKeyPresent && everyDeclaredKeyWellTyped;
};

type Sample = { readonly why: string; readonly value: unknown };

/** Run against EVERY row, so each row is graded on the other rows' arguments too. */
const SAMPLES: readonly Sample[] = [
  { why: "a name, which two rows take", value: { name: "moonlit" } },
  { why: "an entity id, which three rows take", value: { entityId: 7 } },
  {
    why: "a generator id, which one row takes",
    value: { generatorId: "hall" },
  },
  { why: "nothing at all — every row's required key missing", value: {} },
  {
    why: "a valid argument plus a key nobody declared",
    value: { name: "moonlit", ignored: 1 },
  },
  {
    why: "one row's argument is another row's stray key",
    value: { entityId: 7, name: "moonlit" },
  },
  { why: "a number where a string is declared", value: { name: 42 } },
  {
    why: "a boolean where a string is declared",
    value: { generatorId: false },
  },
  { why: "a string where an integer is declared", value: { entityId: "7" } },
  { why: "a number that is not an integer", value: { entityId: 1.5 } },
  {
    why: "an integer past the advertised maximum",
    value: { entityId: Number.MAX_SAFE_INTEGER + 1 },
  },
  { why: "null where a value is declared", value: { entityId: null } },
  { why: "null, which is not an object", value: null },
  { why: "an array, which is not an object", value: [] },
  { why: "a bare string, which is not an object", value: "moonlit" },
];

// THE NUMBERS ARE ASSERTED, NOT DERIVED FROM THE LOOP BOUNDS, and each guards a DIFFERENT
// way this case could pass while checking nothing. All four are the artifact's own counts —
// the case passes only if they match what the loop actually tallies — so recompute them by
// running it when the table moves, never by hand.
//
//   - `PAIRS_COMPARED` as a literal is the emptied-table guard. Writing
//     `SAMPLES.length * rows` on the expected side would let a sample table gutted to zero
//     pass with `0 === 0`.
//   - `PAIRS_ADMITTED` is the both-verdicts guard, and it counts DISPATCH's acceptances —
//     the enforcing side, deliberately, so it does not move when the advertisement breaks.
//     Its job is to keep the samples from drifting all-invalid: against a table nothing
//     accepts, an `admits` that always answered `false` would agree everywhere and this file
//     would pin nothing at all.
//
// The `{}` question — "would this still pass if `toJsonSchema` returned an empty document?" —
// is answered by neither number but by `disagreements`, and it was measured rather than
// argued (T4b Task 6 sabotage, cut A): a `{}` document has no `type: "object"`, so `admits`
// refuses everything, every pair the contract admits turns into a named disagreement, and the
// list reds carrying the row and the sample that broke. The count `admitted` does NOT move
// under that cut, which is why the list and not the count is the answer.
const ROWS = 6;
const SAMPLE_COUNT = 15;
const PAIRS_COMPARED = 90;
const PAIRS_ADMITTED = 13;

test("the advertised schema and the enforced schema reach the same verdict, sample for sample", () => {
  const disagreements: string[] = [];
  let compared = 0;
  let admitted = 0;
  for (const [id, schema] of Object.entries(ACTION_INPUT_SCHEMAS)) {
    const advertised = toJsonSchema(schema, { io: "input" });
    for (const sample of SAMPLES) {
      const wouldSend = admits(advertised, sample.value);
      const isAccepted = schema.safeParse(sample.value).success;
      compared++;
      if (isAccepted) admitted++;
      if (wouldSend !== isAccepted)
        disagreements.push(
          `${id} × ${sample.why}: the advertisement ${wouldSend ? "admits" : "refuses"} it, dispatch ${isAccepted ? "accepts" : "rejects"} it`,
        );
    }
  }
  expect({
    rows: Object.keys(ACTION_INPUT_SCHEMAS).length,
    samples: SAMPLES.length,
    compared,
    admitted,
    disagreements,
  }).toEqual({
    rows: ROWS,
    samples: SAMPLE_COUNT,
    compared: PAIRS_COMPARED,
    admitted: PAIRS_ADMITTED,
    disagreements: [],
  });
});

test("the advertisement says nothing this file cannot read", () => {
  const unread: string[] = [];
  let fieldsWalked = 0;
  for (const [id, schema] of Object.entries(ACTION_INPUT_SCHEMAS)) {
    const advertised = toJsonSchema(schema, { io: "input" });
    for (const keyword of Object.keys(advertised))
      if (!["type", "properties", "required"].includes(keyword))
        unread.push(`${id}: ${keyword}`);
    for (const [name, field] of Object.entries(fieldsOf(advertised))) {
      fieldsWalked++;
      for (const keyword of Object.keys(field))
        if (!["type", "minimum", "maximum"].includes(keyword))
          unread.push(`${id}.${name}: ${keyword}`);
    }
  }
  // WHAT WAS WALKED, ASSERTED BEFORE WHAT WAS FOUND — the vacuity shape this package's
  // leakage suite guards the same way (`frontend-no-engine-leakage.test.ts` names its scanned
  // file list before checking it for offenders). One field per row, and an empty walk with an
  // empty `unread` is a passing test that read nothing.
  expect({ fieldsWalked, unread }).toEqual({ fieldsWalked: ROWS, unread: [] });
});

test("every advertised field is required — the schema header's claim, read off the wire shape", () => {
  // `schemas.ts:37-41` argues it: optionality lives one level up in `InputOf`, so "no input at
  // all" is expressible and "an input that names nothing" is not. On the wire that has to show
  // up as `required` naming EVERY property, which is a claim about the reflected document and
  // not about the zod object — a caller reading a document with an omittable field would send
  // one. The literal also inventories the six: a row added without probes above cannot land
  // here silently.
  const rows = Object.entries(ACTION_INPUT_SCHEMAS).map(([id, schema]) => {
    const advertised = toJsonSchema(schema, { io: "input" });
    return {
      id,
      properties: Object.keys(fieldsOf(advertised)).sort(),
      required: requiredOf(advertised).sort(),
    };
  });
  expect(rows).toEqual([
    { id: "world.saveAs", properties: ["name"], required: ["name"] },
    { id: "world.makeDefault", properties: ["name"], required: ["name"] },
    { id: "edit.duplicate", properties: ["entityId"], required: ["entityId"] },
    { id: "edit.delete", properties: ["entityId"], required: ["entityId"] },
    { id: "edit.grab", properties: ["entityId"], required: ["entityId"] },
    {
      id: "tool.stamp",
      properties: ["generatorId"],
      required: ["generatorId"],
    },
  ]);
});
