<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";

  type Props = {
    stripes: number;
    hue: number;
    onStripesChange: (v: number) => void;
    onHueChange: (v: number) => void;
  };
  let { stripes, hue, onStripesChange, onHueChange }: Props = $props();
</script>

<Slider label="stripes" value={stripes} min={1} max={40} step={1} onChange={onStripesChange} />
<Slider label="hue" value={hue} min={0} max={1} step={0.01} onChange={onHueChange} />
