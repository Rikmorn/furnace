import { expect, test } from "bun:test";
import { computeLayout } from "../../src/binding/layout.ts";

test("scalar struct: { f32, f32, f32 } offsets 0/4/8, uniform size rounds to 16", () => {
  const l = computeLayout(
    { time: "f32", scale: "f32", colorPhase: "f32" },
    "uniform",
  );
  expect(l.fields["time"]).toEqual({ offset: 0, size: 4, token: "f32" });
  expect(l.fields["scale"]).toEqual({ offset: 4, size: 4, token: "f32" });
  expect(l.fields["colorPhase"]).toEqual({ offset: 8, size: 4, token: "f32" });
  expect(l.byteSize).toBe(16); // uniform buffers round up to 16; the manual `_pad: f32` disappears
});

test("vec4f field: align 16, size 16", () => {
  const l = computeLayout({ color: "vec4f" }, "uniform");
  expect(l.fields["color"]).toEqual({ offset: 0, size: 16, token: "vec4f" });
  expect(l.byteSize).toBe(16);
});

test("{ vec3f, f32 }: the f32 packs into the vec3 tail padding at offset 12, struct size 16", () => {
  // WGSL §14.4.2: member offset = roundUp(AlignOf(i), prevOffset + SizeOf(prev)).
  // vec3f is align-16/size-12, so the f32 (align 4) lands at roundUp(4, 0+12)=12,
  // filling the vec3's tail padding — the struct is 16 bytes, NOT 20/32.
  // (Verified against the WGSL spec; the older "f32 at offset 16" framing was wrong.)
  const l = computeLayout({ n: "vec3f", w: "f32" }, "uniform");
  expect(l.fields["n"]).toEqual({ offset: 0, size: 12, token: "vec3f" });
  expect(l.fields["w"]).toEqual({ offset: 12, size: 4, token: "f32" });
  expect(l.byteSize).toBe(16); // roundUp(16, 16)
});

test("the real vec3 footgun: { f32, vec3f } pads the vec3 to offset 16, struct size 32", () => {
  // Here padding genuinely appears: the f32 sits at 0, but the vec3f needs
  // align 16, so it lands at roundUp(16, 0+4)=16, wasting bytes 4–15. Running
  // extent is 16+12=28, rounded up to 32. This is the case where vec3's align
  // actually bites — distinct from { vec3f, f32 } above where the scalar packs.
  const l = computeLayout({ a: "f32", b: "vec3f" }, "uniform");
  expect(l.fields["a"]).toEqual({ offset: 0, size: 4, token: "f32" });
  expect(l.fields["b"]).toEqual({ offset: 16, size: 12, token: "vec3f" });
  expect(l.byteSize).toBe(32); // roundUp(16, 28)
});

test("mat4x4f: align 16, size 64", () => {
  const l = computeLayout({ m: "mat4x4f" }, "uniform");
  expect(l.fields["m"]).toEqual({ offset: 0, size: 64, token: "mat4x4f" });
  expect(l.byteSize).toBe(64);
});

test("mixed: { vec2f, f32 } — f32 at offset 8, size rounds to 16", () => {
  const l = computeLayout({ uv: "vec2f", t: "f32" }, "uniform");
  expect(l.fields["uv"]).toEqual({ offset: 0, size: 8, token: "vec2f" });
  expect(l.fields["t"]).toEqual({ offset: 8, size: 4, token: "f32" });
  expect(l.byteSize).toBe(16);
});

test("unsupported token throws (setup-loud)", () => {
  // @ts-expect-error deliberately invalid token
  expect(() => computeLayout({ x: "vec5f" }, "uniform")).toThrow();
});

test("storage address space is admitted but not yet implemented (loud)", () => {
  expect(() => computeLayout({ x: "f32" }, "storage-readwrite")).toThrow(
    /not yet/i,
  );
});
