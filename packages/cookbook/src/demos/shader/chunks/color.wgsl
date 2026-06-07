// hsv2rgb: standard hue-saturation-value -> RGB. Shared by plasma.wgsl + striped.wgsl
// via shader.source composition (Stage 2.5) instead of copy-paste.
fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let c = v * s;
  let x = c * (1.0 - abs(((h * 6.0) % 2.0) - 1.0));
  let m = v - c;
  var r = 0.0; var g = 0.0; var b = 0.0;
  if (h < 1.0/6.0) { r = c; g = x; b = 0.0; }
  else if (h < 2.0/6.0) { r = x; g = c; b = 0.0; }
  else if (h < 3.0/6.0) { r = 0.0; g = c; b = x; }
  else if (h < 4.0/6.0) { r = 0.0; g = x; b = c; }
  else if (h < 5.0/6.0) { r = x; g = 0.0; b = c; }
  else { r = c; g = 0.0; b = x; }
  return vec3<f32>(r + m, g + m, b + m);
}
