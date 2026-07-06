// packages/dungeon/scripts/hash-world.ts
// Pr-2 probe (3.1 spec §7): canonical FNV-1a 64 hash of a generated wing, run under
// bun (JSC) and node (V8). Identical hashes ⇒ bake-by-regeneration is sound across
// the engines we ship to (Safari=JSC, Chrome/node=V8). STOP condition on mismatch:
// generation.bake switches to browser-uploads-payload (spec §0.2 fallback).
import { buildWorld, COCKPIT_BUDGET, COCKPIT_CONFIG } from "../src/world.ts";

const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;
function fnv(h: bigint, bytes: Uint8Array): bigint {
  for (const b of bytes) {
    h = ((h ^ BigInt(b)) * FNV_PRIME) & MASK;
  }
  return h;
}
const f64 = (h: bigint, nums: readonly number[]): bigint =>
  fnv(h, new Uint8Array(Float64Array.from(nums).buffer));

const seed = process.argv[2] ?? "p1-6-0";
const { layout, attempt } = buildWorld(seed, COCKPIT_CONFIG, COCKPIT_BUDGET);
let h = 0xcbf29ce484222325n;
for (const r of [...layout.regions, ...layout.connectors]) {
  for (const m of r.meshes) {
    h = f64(h, m.position);
    if (m.rotation) h = f64(h, m.rotation);
    if (m.scale) h = f64(h, m.scale);
    if ("box" in m.geometry) h = f64(h, m.geometry.box);
    else {
      for (const v of Object.values(m.geometry.custom)) {
        if (ArrayBuffer.isView(v)) {
          h = fnv(h, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        }
      }
    }
  }
  for (const g of r.instances) {
    h = fnv(
      h,
      new Uint8Array(
        g.transforms.buffer,
        g.transforms.byteOffset,
        g.transforms.byteLength,
      ),
    );
    h = fnv(
      h,
      new Uint8Array(g.tints.buffer, g.tints.byteOffset, g.tints.byteLength),
    );
  }
  for (const c of r.colliders) h = f64(h, c.position);
}
console.log(`WORLDHASH seed=${seed} attempt=${attempt} hash=${h.toString(16)}`);
