import { expect, test } from "bun:test";
import { source, toWgsl } from "@furnace/core/shader";

test("single fragment round-trips its body", () => {
  const s = source`fn a() {}`;
  expect(toWgsl(s)).toBe("fn a() {}");
});

test("ShaderSource interpolation is a hoisted dependency, not positional text", () => {
  const dep = source`fn dep() {}`;
  const root = source`${dep}\n@fragment fn main() {}`;
  // dep emitted first (post-order); root body keeps only its own text (dep stripped)
  expect(toWgsl(root)).toBe("fn dep() {}\n\n\n@fragment fn main() {}");
});

test("string and number interpolations are inlined positionally", () => {
  const n = 16;
  const s = source`const MAX: u32 = ${n}; const ONE: f32 = ${"1.0"};`;
  expect(toWgsl(s)).toBe("const MAX: u32 = 16; const ONE: f32 = 1.0;");
});

test("call form composes a body with explicit deps", () => {
  const dep = source("fn dep() {}");
  const root = source("@fragment fn main() {}", [dep]);
  expect(toWgsl(root)).toBe("fn dep() {}\n\n@fragment fn main() {}");
});

test("diamond dependency is dedup'd to a single emission, deps before dependents", () => {
  const shared = source`fn shared() {}`;
  const a = source`${shared}\nfn a() {}`;
  const b = source`${shared}\nfn b() {}`;
  const root = source`${a}\n${b}\n@fragment fn main() {}`;
  const out = toWgsl(root);
  expect(out.match(/fn shared\(\)/g)?.length).toBe(1); // emitted ONCE despite two paths
  expect(out.indexOf("fn shared")).toBeLessThan(out.indexOf("fn a"));
  expect(out.indexOf("fn a")).toBeLessThan(out.indexOf("fn b"));
  expect(out.indexOf("fn b")).toBeLessThan(out.indexOf("fn main"));
});

test("a fragment with no deps round-trips its body unchanged", () => {
  expect(toWgsl(source("fn solo() {}"))).toBe("fn solo() {}");
});

test("invalid interpolant throws setup-loud", () => {
  // @ts-expect-error deliberately invalid interpolant (undefined ~ a TDZ/cycle symptom)
  expect(() => source`x ${undefined} y`).toThrow(/invalid interpolation/);
  // @ts-expect-error deliberately invalid interpolant (arbitrary object)
  expect(() => source`x ${{}} y`).toThrow(/invalid interpolation/);
});
