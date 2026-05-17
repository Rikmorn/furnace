<script lang="ts">
  import { overlayState } from "./state.svelte.ts";
</script>

<div class="fps-overlay">{overlayState.fps} fps</div>

<style>
  .fps-overlay {
    position: fixed;
    top: 8px;
    left: 8px;
    color: #fff;
    background: rgba(0, 0, 0, 0.5);
    padding: 4px 8px;
    font: 12px/1.2 ui-monospace, monospace;
    pointer-events: none;
    user-select: none;
  }
</style>
