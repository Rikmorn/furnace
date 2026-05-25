export const state: {
  threshold: number;
  intensity: number;
  radius: number;
  haloMaskStart: number;
  vignetteStrength: number;
  vignetteFalloff: number;
  bloomOn: boolean;
  vignetteOn: boolean;
  swapOrder: boolean;
  angle: number;
} = $state({
  threshold: 0.7, // catches +Y face (lum 0.86) and side faces mid-rotation (peak 0.61)
  intensity: 4.0, // hot enough that the halo bleeds visibly into vignette territory
  radius: 0.012, // ~12 px on a 1000-wide canvas — wide enough to soften, narrow enough to localise
  haloMaskStart: 0.6, // the magic constant promoted out of bloom.wgsl
  vignetteStrength: 0.5, // corners drop to 50% — visible without being oppressive
  vignetteFalloff: 0.5, // band runs 0.5 → 0.8 (mid-frame to edge) — visibly affects bloom reach
  bloomOn: true,
  vignetteOn: true,
  swapOrder: false,
  angle: 0,
});
