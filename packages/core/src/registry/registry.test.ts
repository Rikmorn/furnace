import { afterEach, expect, test } from "bun:test";
import { FurnaceError } from "../errors.ts";
import {
  createRegistry,
  defineService,
  getService,
  parseOrThrow,
  resetServicesForTests,
  toJsonSchema,
  z,
} from "./index.ts";

afterEach(() => {
  resetServicesForTests();
});

test("register/get round-trips an entry", () => {
  const r = createRegistry<number>({ prefix: "x", noun: "thing" });
  r.register("a", 1);
  expect(r.get("a")).toBe(1);
  expect(r.get("missing")).toBeUndefined();
});

test("duplicate registration throws the prefix/noun-shaped message", () => {
  const r = createRegistry<number>({ prefix: "field", noun: "generator" });
  r.register("hall", 1);
  expect(() => r.register("hall", 2)).toThrow(FurnaceError);
  expect(() => r.register("hall", 2)).toThrow(
    'field: generator "hall" is already registered',
  );
});

test("entries() preserves registration order", () => {
  const r = createRegistry<number>({ prefix: "x", noun: "thing" });
  r.register("b", 2);
  r.register("a", 1);
  r.register("c", 3);
  expect(r.entries().map(([name]) => name)).toEqual(["b", "a", "c"]);
});

test("reset() empties the store and allows re-registration", () => {
  const r = createRegistry<number>({ prefix: "x", noun: "thing" });
  r.register("a", 1);
  r.reset();
  expect(r.get("a")).toBeUndefined();
  expect(r.entries()).toEqual([]);
  r.register("a", 2);
  expect(r.get("a")).toBe(2);
});

test("toJsonSchema strips the root $schema key", () => {
  const out = toJsonSchema(z.strictObject({ a: z.number() }), {
    io: "output",
  });
  expect("$schema" in out).toBe(false);
  expect(out["type"]).toBe("object");
});

test("toJsonSchema honors io: defaulted field required under output, absent under input", () => {
  const shape = z.strictObject({ a: z.number().default(1) });
  const output = toJsonSchema(shape, { io: "output" });
  expect(output["required"]).toEqual(["a"]);
  const input = toJsonSchema(shape, { io: "input" });
  expect(input["required"]).toBeUndefined();
});

test("getService throws a nameable FurnaceError when unregistered", () => {
  expect(() => getService("analyzerVerify")).toThrow(FurnaceError);
  expect(() => getService("analyzerVerify")).toThrow(
    'registry: service "analyzerVerify" is not registered',
  );
});

test("defineService/getService round-trips the function", () => {
  const fn = () => "ok";
  defineService("fixtureService", { fn });
  expect(getService("fixtureService")).toBe(fn);
});

test("duplicate defineService throws setup-loud", () => {
  defineService("dup", { fn: () => 1 });
  expect(() => defineService("dup", { fn: () => 2 })).toThrow(
    'registry: service "dup" is already registered',
  );
});

test("parseOrThrow formats failures with the caller's prefix", () => {
  const schema = z.strictObject({ width: z.number().min(4) });
  expect(() =>
    parseOrThrow(schema, { width: 1 }, "hall params", "field"),
  ).toThrow(FurnaceError);
  expect(() =>
    parseOrThrow(schema, { width: 1 }, "hall params", "field"),
  ).toThrow(/^field: hall params invalid at "width": /);
});

test("parseOrThrow returns parsed data with defaults applied", () => {
  const schema = z.strictObject({ a: z.number().default(7) });
  expect(parseOrThrow(schema, {}, "thing", "x")).toEqual({ a: 7 });
});
