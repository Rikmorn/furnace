<script lang="ts">
  type Props = {
    label: string;
    value: boolean;
    onChange: (next: boolean) => void;
  };
  let { label, value, onChange }: Props = $props();
</script>

<label class="toggle">
  <input
    type="checkbox"
    checked={value}
    onchange={(e) => onChange(e.currentTarget.checked)}
  />
  <span class="label">{label}</span>
</label>

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    cursor: pointer;
  }
  .label { color: var(--text-muted); font-size: 12px; }
  input[type="checkbox"] { accent-color: var(--accent); }
</style>
