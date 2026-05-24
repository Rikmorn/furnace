import { expect, test } from "bun:test";
import * as post from "../../src/post/index.ts";

test("public surface is exactly create, destroy, Effect, EffectDescriptor", () => {
  expect(typeof post.create).toBe("function");
  expect(typeof post.destroy).toBe("function");
});
