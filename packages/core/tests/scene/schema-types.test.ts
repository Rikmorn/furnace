import { expect, test } from "bun:test";
import { z } from "zod";
import type { Geometry } from "../../src/geometry/index.ts";
import type { Material } from "../../src/material/index.ts";
import type { ResolvedParamsOf } from "../../src/scene/schema.ts";
import * as t from "../../src/scene/t.ts";
import type { Shader } from "../../src/shader/types.ts";

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

test("type assertions compile (see typecheck gate)", () => {
  expect(true).toBe(true);
});
