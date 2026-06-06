<script lang="ts">
  import type { ToneMapOperator } from "@furnace/core/post";
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import Select from "../../shared/ui/Select.svelte";
  import Slider from "../../shared/ui/Slider.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";

  type Props = {
    operator: ToneMapOperator;
    exposure: number;
    bloomIntensity: number;
    bloomOn: boolean;
    blurOn: boolean;
    vignetteOn: boolean;
    vignetteStrength: number;
    vignetteFalloff: number;
    // operator + exposure recreate the tonemap effect; intensity recreates
    // bloom. The *Change handlers update the slider value live (cheap); the
    // *Commit handlers fire once on release and do the GPU recreate.
    onOperatorChange: (v: ToneMapOperator) => void;
    onExposureChange: (v: number) => void;
    onExposureCommit: (v: number) => void;
    onBloomIntensityChange: (v: number) => void;
    onBloomIntensityCommit: (v: number) => void;
    onBloomOnChange: (v: boolean) => void;
    onBlurOnChange: (v: boolean) => void;
    onVignetteOnChange: (v: boolean) => void;
    onVignetteStrengthChange: (v: number) => void;
    onVignetteFalloffChange: (v: number) => void;
  };
  let {
    operator,
    exposure,
    bloomIntensity,
    bloomOn,
    blurOn,
    vignetteOn,
    vignetteStrength,
    vignetteFalloff,
    onOperatorChange,
    onExposureChange,
    onExposureCommit,
    onBloomIntensityChange,
    onBloomIntensityCommit,
    onBloomOnChange,
    onBlurOnChange,
    onVignetteOnChange,
    onVignetteStrengthChange,
    onVignetteFalloffChange,
  }: Props = $props();

  const isOperator = makeUnionGuard<ToneMapOperator>(["neutral", "reinhard"]);
  const OPERATOR_OPTIONS = [
    { value: "neutral", label: "neutral (PBR)" },
    { value: "reinhard", label: "reinhard" },
  ];
</script>

<Select
  label="operator"
  value={operator}
  options={OPERATOR_OPTIONS}
  onChange={(v) => { if (isOperator(v)) onOperatorChange(v); }}
/>
<Slider label="exposure" value={exposure} min={0.1} max={3} step={0.05} onChange={onExposureChange} onCommit={onExposureCommit} />
<Slider label="bloom int." value={bloomIntensity} min={0} max={4} step={0.05} onChange={onBloomIntensityChange} onCommit={onBloomIntensityCommit} />
<Slider label="vig. strength" value={vignetteStrength} min={0} max={1} step={0.01} onChange={onVignetteStrengthChange} />
<Slider label="vig. falloff" value={vignetteFalloff} min={0} max={1} step={0.01} onChange={onVignetteFalloffChange} />
<Toggle label="bloom" value={bloomOn} onChange={onBloomOnChange} />
<Toggle label="blur (multi-pass)" value={blurOn} onChange={onBlurOnChange} />
<Toggle label="vignette" value={vignetteOn} onChange={onVignetteOnChange} />
