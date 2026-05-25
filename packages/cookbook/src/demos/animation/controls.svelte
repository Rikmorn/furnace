<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";

  type Props = {
    rate: number;
    fixedHz: number;
    onRateChange: (v: number) => void;
    onFixedHzChange: (v: number) => void;
  };
  let { rate, fixedHz, onRateChange, onFixedHzChange }: Props = $props();
</script>

<Slider label="rate" value={rate} min={0} max={3} step={0.01} onChange={onRateChange} />
<Slider label="fixed Hz" value={fixedHz} min={5} max={120} step={1} onChange={onFixedHzChange} />
