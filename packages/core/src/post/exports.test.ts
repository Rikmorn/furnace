import { expect, test } from "bun:test";
import * as post from "./index.ts";

test("public surface exposes create, createPasses, destroy, tonemap", () => {
  expect(typeof post.create).toBe("function");
  expect(typeof post.createPasses).toBe("function");
  expect(typeof post.destroy).toBe("function");
  expect(typeof post.tonemap).toBe("function");
});
