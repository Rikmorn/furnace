<script lang="ts">
  type Props = { label: string; onClick: () => void };
  let { label, onClick }: Props = $props();
</script>

<button type="button" onclick={onClick}>{label}</button>

<style>
  button {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    margin-bottom: var(--space-2);
  }
  button:hover { background: var(--surface-hover); border-color: var(--accent); }
</style>
