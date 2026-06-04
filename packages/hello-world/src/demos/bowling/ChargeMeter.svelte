<script lang="ts">
  import { chargeMeter } from "./charge-meter-state.svelte.ts";
</script>

{#if chargeMeter.phase === "aiming"}
  <div class="meter">
    <div class="track">
      <div class="fill" style="width: {chargeMeter.charge * 100}%"></div>
    </div>
    <div class="label">charge</div>
  </div>
{/if}

<style>
  .meter {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    width: 240px;
    color: #fff;
    background: rgba(0, 0, 0, 0.5);
    padding: 6px 8px;
    font: 12px/1.4 ui-monospace, monospace;
    pointer-events: none;
    user-select: none;
  }
  .track {
    width: 100%;
    height: 10px;
    background: rgba(255, 255, 255, 0.15);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: #ffb340;
  }
  .label {
    margin-top: 4px;
    text-align: center;
  }
</style>
