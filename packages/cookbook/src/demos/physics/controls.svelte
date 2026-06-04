<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";

  type Props = {
    interpolate: boolean;
    fixedHz: number;
    onInterpolateChange: (v: boolean) => void;
    onFixedHzChange: (v: number) => void;
    onReset: () => void;
    showColliders: boolean;
    onShowCollidersChange: (v: boolean) => void;
  };
  let {
    interpolate,
    fixedHz,
    onInterpolateChange,
    onFixedHzChange,
    onReset,
    showColliders,
    onShowCollidersChange,
  }: Props = $props();
</script>

<label class="toggle">
  <input
    type="checkbox"
    checked={interpolate}
    onchange={(e) => onInterpolateChange(e.currentTarget.checked)}
  />
  <span>interpolate</span>
</label>
<label class="toggle">
  <input
    type="checkbox"
    checked={showColliders}
    onchange={(e) => onShowCollidersChange(e.currentTarget.checked)}
  />
  <span>colliders</span>
</label>
<Slider label="fixed Hz" value={fixedHz} min={5} max={120} step={1} onChange={onFixedHzChange} />
<button class="reset" type="button" onclick={onReset}>reset</button>

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    color: var(--text-muted);
    font-size: 12px;
  }
  .toggle input[type="checkbox"] {
    accent-color: var(--accent);
  }
  .reset {
    margin-top: var(--space-2);
    padding: 0.25rem 0.75rem;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
    background: var(--surface, rgba(255, 255, 255, 0.08));
    border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
    border-radius: 3px;
    cursor: pointer;
  }
  .reset:hover {
    border-color: var(--accent);
  }
</style>
