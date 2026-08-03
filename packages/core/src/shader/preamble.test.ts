import { expect, test } from "bun:test";
import { toWgsl } from "@furnace/core/shader";
import { _cameraBinding, _objectBinding, _vsIn } from "./preamble.ts";

test("camera binding fragment declares @group(0) @binding(0) with position", () => {
  const wgsl = toWgsl(_cameraBinding);
  expect(wgsl).toContain("@group(0) @binding(0) var<uniform> camera: Camera");
  expect(wgsl).toContain("viewProjection: mat4x4<f32>");
  expect(wgsl).toContain("position: vec4<f32>");
});

test("object binding fragment declares @group(2) @binding(0) with normalMatrix", () => {
  const wgsl = toWgsl(_objectBinding);
  expect(wgsl).toContain("@group(2) @binding(0) var<uniform> object: Object");
  expect(wgsl).toContain("model: mat4x4<f32>");
  expect(wgsl).toContain("normalMatrix: mat4x4<f32>");
  expect(wgsl).not.toContain("@group(0) @binding(1)");
});

test("vsIn fragment declares the interleaved vertex input", () => {
  const wgsl = toWgsl(_vsIn);
  expect(wgsl).toContain("@location(0) position: vec3<f32>");
  expect(wgsl).toContain("@location(1) normal: vec3<f32>");
  expect(wgsl).toContain("@location(2) uv: vec2<f32>");
});
