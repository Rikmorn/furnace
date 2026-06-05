export type SamplerPreset = "nearest" | "linear" | "linear-af16";

export const SAMPLER_PRESET_OPTIONS: Array<{
  value: SamplerPreset;
  label: string;
}> = [
  { value: "nearest", label: "nearest (blocky)" },
  { value: "linear", label: "linear (smooth)" },
  { value: "linear-af16", label: "linear + AF×16 (sharp at angle)" },
];

export const state: {
  preset: SamplerPreset;
} = $state({
  // Start on 'nearest' so the blocky pixellation is the first thing the user sees —
  // the AF win is more striking when you've already seen the worst case.
  preset: "nearest",
});
