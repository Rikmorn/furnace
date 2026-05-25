<script lang="ts">
  type Props = {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    onChange: (next: number) => void;
  };
  let { label, value, min = 0, max = 1, step = 0.01, onChange }: Props = $props();
</script>

<label class="slider">
  <span class="label">{label}</span>
  <input
    type="range"
    {min}
    {max}
    {step}
    {value}
    oninput={(e) => onChange(Number(e.currentTarget.value))}
  />
  <span class="value">{value.toFixed(step < 0.1 ? 3 : 2)}</span>
</label>

<style>
  .slider {
    display: grid;
    grid-template-columns: 80px 1fr 60px;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .label { color: var(--text-muted); font-size: 12px; }
  .value { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); text-align: right; }
  input[type="range"] { accent-color: var(--accent); width: 100%; }
</style>
