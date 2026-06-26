<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";

  type Props = {
    grid: number;
    spin: boolean;
    onGridChange: (v: number) => void;
    onSpinChange: (v: boolean) => void;
  };
  let { grid, spin, onGridChange, onSpinChange }: Props = $props();

  const count = $derived(grid * grid);
</script>

<Slider label="grid" value={grid} min={1} max={16} step={1} onChange={onGridChange} />
<Toggle label="spin" value={spin} onChange={onSpinChange} />
<p class="count">{count} instances · 1 draw call</p>

<style>
  .count {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
