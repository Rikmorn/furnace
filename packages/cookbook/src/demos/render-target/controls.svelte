<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";

  type Props = {
    pipSize: number;
    onPipSizeChange: (v: number) => void;
  };
  let { pipSize, onPipSizeChange }: Props = $props();
</script>

<Slider label="pip-size" value={pipSize} min={0.1} max={0.5} step={0.01} onChange={onPipSizeChange} />
