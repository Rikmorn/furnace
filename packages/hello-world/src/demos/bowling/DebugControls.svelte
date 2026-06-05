<script lang="ts">
  import { debugControls } from "./debug-controls-state.svelte.ts";
</script>

<div class="debug">
  <label class="row">
    <input
      type="checkbox"
      checked={debugControls.showColliders}
      onchange={(e) => (debugControls.showColliders = e.currentTarget.checked)}
    />
    <span>colliders</span>
  </label>
  <label class="row">
    <input
      type="checkbox"
      checked={debugControls.paused}
      onchange={(e) => (debugControls.paused = e.currentTarget.checked)}
    />
    <span>pause</span>
  </label>
  <label class="row">
    <span>speed {debugControls.timeScale.toFixed(2)}×</span>
    <input
      type="range"
      min="0.1"
      max="1"
      step="0.05"
      value={debugControls.timeScale}
      oninput={(e) => (debugControls.timeScale = e.currentTarget.valueAsNumber)}
    />
  </label>
  <button type="button" onclick={() => (debugControls.stepRequested = true)}>
    step
  </button>
  <label class="row">
    <input
      type="checkbox"
      checked={debugControls.anisotropy}
      onchange={(e) => (debugControls.anisotropy = e.currentTarget.checked)}
    />
    <span>anisotropy (AF)</span>
  </label>
</div>

<style>
  .debug {
    position: fixed;
    /* Sits below the shell scene selector (top-right, ~32px tall) so the two
       top-right overlays don't collide; right edge aligned with the selector. */
    top: 44px;
    right: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    font-family: monospace;
    font-size: 12px;
    color: #e6e6e6;
    background: rgba(0, 0, 0, 0.45);
    border-radius: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  button {
    font-family: monospace;
    font-size: 12px;
    cursor: pointer;
  }
</style>
