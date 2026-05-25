<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";

  type Props = {
    stripes: number;
    hue: number;
    softness: number;
    plasmaScale: number;
    plasmaPhase: number;
    onStripesChange: (v: number) => void;
    onHueChange: (v: number) => void;
    onSoftnessChange: (v: number) => void;
    onPlasmaScaleChange: (v: number) => void;
    onPlasmaPhaseChange: (v: number) => void;
  };
  let {
    stripes,
    hue,
    softness,
    plasmaScale,
    plasmaPhase,
    onStripesChange,
    onHueChange,
    onSoftnessChange,
    onPlasmaScaleChange,
    onPlasmaPhaseChange,
  }: Props = $props();
</script>

<Slider label="stripes" value={stripes} min={1} max={40} step={1} onChange={onStripesChange} />
<Slider label="hue" value={hue} min={0} max={1} step={0.01} onChange={onHueChange} />
<Slider label="softness" value={softness} min={0} max={0.2} step={0.005} onChange={onSoftnessChange} />
<Slider label="plasmaScale" value={plasmaScale} min={2} max={24} step={0.5} onChange={onPlasmaScaleChange} />
<Slider label="plasmaPhase" value={plasmaPhase} min={0} max={1} step={0.01} onChange={onPlasmaPhaseChange} />
