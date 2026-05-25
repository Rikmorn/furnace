<script lang="ts">
  import { overlay } from "./stats-state.svelte.ts";
  const fmtMib = (n: number) => n < 0.05 ? "0.0" : n.toFixed(1);
  const fmtMs = (n: number) => n.toFixed(1);
</script>

<div class="overlay">
  <div>{overlay.fps.toFixed(0)} fps&nbsp;&nbsp;{fmtMs(overlay.frameMsLast)} ms&nbsp;&nbsp;(mean {fmtMs(overlay.frameMsMean)})</div>
  <div>{overlay.drawCalls} draws&nbsp;&nbsp;{overlay.triangles} tris&nbsp;&nbsp;{overlay.materials} mat&nbsp;&nbsp;{overlay.geometries} geo&nbsp;&nbsp;{overlay.meshes} mesh</div>
  <div>mem {fmtMib(overlay.memoryMiB)} MiB</div>
  {#if overlay.uncapturedErrors > 0}
    <div class="errors">errors: {overlay.uncapturedErrors}</div>
  {/if}
</div>

<style>
  .overlay {
    color: var(--text);
    font: 12px/1.4 var(--font-mono);
    user-select: none;
  }
  .errors {
    color: #ff7070;
  }
</style>
