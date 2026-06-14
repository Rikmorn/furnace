import { expect, test } from "bun:test";
import { z } from "zod";
import type { Geometry } from "../../src/geometry/index.ts";
import type { Material } from "../../src/material/index.ts";
import {
  fieldFurnaceMeta,
  type ResolvedParamsOf,
} from "../../src/scene/schema.ts";
import * as t from "../../src/scene/t.ts";
import type { Shader } from "../../src/shader/types.ts";
import type { Texture } from "../../src/texture/index.ts";

const shape = {
  geometry: t.resource("geometries"),
  material: t.resource("materials"),
  detail: t.resource("shaders").optional(),
  aim: t.ref("transform").optional(),
  name: z.string(),
  count: z.number().optional(),
  position: t.vec3().optional(),
};

type Doc = z.infer<z.ZodObject<typeof shape>>;
type Build = ResolvedParamsOf<typeof shape>;

type Expect<T extends true> = T;
type Eq<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
    ? true
    : false;

// Document side: refs are plain strings.
type _d1 = Expect<Eq<Doc["geometry"], string>>;
type _d2 = Expect<Eq<Doc["count"], number | undefined>>;
// Build side: resource refs are live handles; ref/plain/tuple fields untouched.
type _b1 = Expect<Eq<Build["geometry"], Geometry>>;
type _b2 = Expect<Eq<Build["material"], Material>>;
type _b3 = Expect<Eq<Build["detail"], Shader | undefined>>;
type _b4 = Expect<Eq<Build["aim"], string | undefined>>; // t.ref stays an id until M6
type _b5 = Expect<Eq<Build["name"], string>>;
type _b6 = Expect<Eq<Build["count"], number | undefined>>;
type _b7 = Expect<Eq<Build["position"], [number, number, number] | undefined>>;

// Nested-object recursion: resource refs inside a nested z.ZodObject resolve to
// their live handle types; non-resource fields pass through unchanged.
const nestedShape = {
  // required nested object containing a t.resource ref
  textureSettings: z.strictObject({
    texture: t.resource("textures"),
    sampler: z
      .strictObject({ maxAnisotropy: z.number().optional() })
      .optional(),
  }),
  // optional nested object containing a t.resource ref
  overlay: z
    .strictObject({
      texture: t.resource("textures"),
    })
    .optional(),
};

type NestedBuild = ResolvedParamsOf<typeof nestedShape>;

// Required nested object: inner resource field → live handle; inner plain field untouched.
type _n1 = Expect<Eq<NestedBuild["textureSettings"]["texture"], Texture>>;
type _n2 = Expect<
  Eq<
    NestedBuild["textureSettings"]["sampler"],
    { maxAnisotropy?: number | undefined } | undefined
  >
>;
// Optional nested object: resolves to `{ texture: Texture } | undefined`.
type _n3 = Expect<Eq<NestedBuild["overlay"], { texture: Texture } | undefined>>;

test("type assertions compile (see typecheck gate)", () => {
  expect(true).toBe(true);
});

test("t.color carries furnace.kind 'color' and parses a 4-tuple", () => {
  const c = t.color();
  expect(fieldFurnaceMeta(c)).toEqual({ kind: "color" });
  expect(c.safeParse([1, 0, 0, 1]).success).toBe(true);
  expect(c.safeParse([1, 0, 0]).success).toBe(false);
});

test("t.color optional unwraps to the same meta", () => {
  expect(
    fieldFurnaceMeta(t.color().optional() as unknown as z.ZodType),
  ).toEqual({
    kind: "color",
  });
});
