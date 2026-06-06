import type { ToneMapOperator } from "@furnace/core/post";

export const state: {
  // tonemap (always the final effect under HDR) — operator + exposure are
  // create-time params, so changing them RECREATES the tonemap effect.
  operator: ToneMapOperator;
  exposure: number;
  // bloom — intensity is a create-time param, so changing it RECREATES bloom.
  bloomIntensity: number;
  // chain toggles for the three mid-chain effects.
  bloomOn: boolean;
  blurOn: boolean;
  vignetteOn: boolean;
  // vignette (consumer 1-in-1-out effect) — live params, written every frame.
  vignetteStrength: number;
  vignetteFalloff: number;
  angle: number;
} = $state({
  operator: "neutral",
  exposure: 1.0,
  bloomIntensity: 1.5, // hot enough that the emissive accent visibly halos
  bloomOn: true,
  blurOn: false, // off by default — the consumer multi-pass effect is opt-in
  vignetteOn: true,
  vignetteStrength: 0.5,
  vignetteFalloff: 0.5,
  angle: 0,
});
