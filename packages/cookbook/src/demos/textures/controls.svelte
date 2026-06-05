<script lang="ts">
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import Select from "../../shared/ui/Select.svelte";
  import type { SamplerPreset } from "./state.svelte.ts";
  import { SAMPLER_PRESET_OPTIONS } from "./state.svelte.ts";

  type Props = {
    preset: SamplerPreset;
    onPresetChange: (v: SamplerPreset) => void;
  };
  let { preset, onPresetChange }: Props = $props();

  const isSamplerPreset = makeUnionGuard<SamplerPreset>([
    "nearest",
    "linear",
    "linear-af16",
  ]);
</script>

<Select
  label="sampler"
  value={preset}
  options={SAMPLER_PRESET_OPTIONS}
  onChange={(v) => { if (isSamplerPreset(v)) onPresetChange(v); }}
/>
