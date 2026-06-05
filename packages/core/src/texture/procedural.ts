/** Pixel data produced by a procedural texture generator: tightly-packed rgba8,
 *  row-major, `data.length === width * height * 4`. Feeds `texture.create({ data, width, height })`. */
export type ProceduralResult = {
  data: Uint8Array;
  width: number;
  height: number;
};

type Rgb = readonly [number, number, number];

const LIGHT: Rgb = [200, 200, 200];
const DARK: Rgb = [40, 40, 40];

/** Bytes per texel for rgba8 (r, g, b, a). */
const RGBA8_BYTES_PER_TEXEL = 4;

/** Generate a checkerboard rgba8 texture: `cells`×`cells` squares alternating
 *  `colorA`/`colorB` over a `size`×`size` image. Pure — returns pixel data, not a
 *  GPU resource; pass the result to `texture.create`. */
export function checkerboard(
  opts: { size?: number; cells?: number; colorA?: Rgb; colorB?: Rgb } = {},
): ProceduralResult {
  const size = opts.size ?? 256;
  const cells = opts.cells ?? 8;
  const colorA = opts.colorA ?? LIGHT;
  const colorB = opts.colorB ?? DARK;
  const data = new Uint8Array(size * size * RGBA8_BYTES_PER_TEXEL);
  const cellPx = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isA = ((Math.floor(x / cellPx) + Math.floor(y / cellPx)) & 1) === 0;
      const c = isA ? colorA : colorB;
      const i = (y * size + x) * RGBA8_BYTES_PER_TEXEL;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

/** Generate a UV-test grid: thin gridlines (`lineColor`, `lineWidth` px) every
 *  `size/cells` px over a `background`, on a `size`×`size` rgba8 image. Useful for
 *  reading filtering / anisotropy at grazing angles. Pure — pass to `texture.create`. */
export function uvGrid(
  opts: {
    size?: number;
    cells?: number;
    lineWidth?: number;
    lineColor?: Rgb;
    background?: Rgb;
  } = {},
): ProceduralResult {
  const size = opts.size ?? 256;
  const cells = opts.cells ?? 8;
  const lineWidth = opts.lineWidth ?? 1;
  const lineColor = opts.lineColor ?? DARK;
  const background = opts.background ?? LIGHT;
  const data = new Uint8Array(size * size * RGBA8_BYTES_PER_TEXEL);
  const cellPx = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onLine = x % cellPx < lineWidth || y % cellPx < lineWidth;
      const c = onLine ? lineColor : background;
      const i = (y * size + x) * RGBA8_BYTES_PER_TEXEL;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}
