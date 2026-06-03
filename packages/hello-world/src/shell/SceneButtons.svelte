<script lang="ts">
  import { switcher } from "./switcher-state.svelte.ts";
  type Props = { labels: string[]; onSelect: (index: number) => void };
  let { labels, onSelect }: Props = $props();
</script>

<div class="switch">
  {#each labels as label, i (label)}
    <button
      class:active={switcher.activeIndex === i}
      disabled={switcher.switching}
      onclick={() => onSelect(i)}
    >{label}</button>
  {/each}
</div>

<style>
  .switch {
    position: fixed;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
  }
  button {
    font: 12px ui-monospace, monospace;
    color: #ddd;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
  }
  button.active { border-color: #8ab4ff; color: #fff; }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
