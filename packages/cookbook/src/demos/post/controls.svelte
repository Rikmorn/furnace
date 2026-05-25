<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";

  type Props = {
    threshold: number;
    intensity: number;
    radius: number;
    bypass: boolean;
    onThresholdChange: (v: number) => void;
    onIntensityChange: (v: number) => void;
    onRadiusChange: (v: number) => void;
    onBypassChange: (v: boolean) => void;
  };
  let {
    threshold,
    intensity,
    radius,
    bypass,
    onThresholdChange,
    onIntensityChange,
    onRadiusChange,
    onBypassChange,
  }: Props = $props();
</script>

<Slider label="threshold" value={threshold} min={0} max={1} step={0.01} onChange={onThresholdChange} />
<Slider label="intensity" value={intensity} min={0} max={6} step={0.05} onChange={onIntensityChange} />
<Slider label="radius" value={radius} min={0.001} max={0.025} step={0.0005} onChange={onRadiusChange} />
<Toggle label="bypass" value={bypass} onChange={onBypassChange} />
