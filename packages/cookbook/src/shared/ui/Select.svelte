<script lang="ts">
  type Option = { value: string; label: string };
  type Props = {
    label: string;
    value: string;
    options: Option[];
    onChange: (next: string) => void;
  };
  let { label, value, options, onChange }: Props = $props();
</script>

<label class="select">
  <span class="label">{label}</span>
  <select {value} onchange={(e) => onChange(e.currentTarget.value)}>
    {#each options as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
</label>

<style>
  .select {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .label { color: var(--text-muted); font-size: 12px; }
  select {
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 4px var(--space-2);
  }
</style>
