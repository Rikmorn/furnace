<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";

  type Props = {
    threshold: number;
    intensity: number;
    radius: number;
    haloMaskStart: number;
    vignetteStrength: number;
    vignetteFalloff: number;
    bloomOn: boolean;
    vignetteOn: boolean;
    swapOrder: boolean;
    onThresholdChange: (v: number) => void;
    onIntensityChange: (v: number) => void;
    onRadiusChange: (v: number) => void;
    onHaloMaskStartChange: (v: number) => void;
    onVignetteStrengthChange: (v: number) => void;
    onVignetteFalloffChange: (v: number) => void;
    onBloomOnChange: (v: boolean) => void;
    onVignetteOnChange: (v: boolean) => void;
    onSwapOrderChange: (v: boolean) => void;
  };
  let {
    threshold,
    intensity,
    radius,
    haloMaskStart,
    vignetteStrength,
    vignetteFalloff,
    bloomOn,
    vignetteOn,
    swapOrder,
    onThresholdChange,
    onIntensityChange,
    onRadiusChange,
    onHaloMaskStartChange,
    onVignetteStrengthChange,
    onVignetteFalloffChange,
    onBloomOnChange,
    onVignetteOnChange,
    onSwapOrderChange,
  }: Props = $props();
</script>

<Slider label="threshold" value={threshold} min={0} max={1} step={0.01} onChange={onThresholdChange} />
<Slider label="radius" value={radius} min={0.001} max={0.025} step={0.0005} onChange={onRadiusChange} />
<Slider label="intensity" value={intensity} min={0} max={6} step={0.05} onChange={onIntensityChange} />
<Slider label="haloMaskStart" value={haloMaskStart} min={0} max={1} step={0.01} onChange={onHaloMaskStartChange} />
<Slider label="vignetteStrength" value={vignetteStrength} min={0} max={1} step={0.01} onChange={onVignetteStrengthChange} />
<Slider label="vignetteFalloff" value={vignetteFalloff} min={0} max={1} step={0.01} onChange={onVignetteFalloffChange} />
<Toggle label="bloom" value={bloomOn} onChange={onBloomOnChange} />
<Toggle label="vignette" value={vignetteOn} onChange={onVignetteOnChange} />
<Toggle label="swapOrder" value={swapOrder} onChange={onSwapOrderChange} />
