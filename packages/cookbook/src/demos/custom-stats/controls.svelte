<script lang="ts">
  import Button from "../../shared/ui/Button.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";

  type Props = {
    cubeCount: number;
    spawnTotal: number;
    despawnTotal: number;
    heavyLoop: boolean;
    heavyMs: number;
    fpsHistory: number[];
    onSpawn: () => void;
    onDespawn: () => void;
    onHeavyLoopChange: (v: boolean) => void;
  };
  let {
    cubeCount,
    spawnTotal,
    despawnTotal,
    heavyLoop,
    heavyMs,
    fpsHistory,
    onSpawn,
    onDespawn,
    onHeavyLoopChange,
  }: Props = $props();

  // Anchor the graph's y-axis to a stable ceiling — 60 fps is the common case,
  // but allow it to climb if the runtime sustains higher (e.g. 120 Hz displays).
  const FPS_GRAPH_CEILING = 60;
  const GRAPH_HEIGHT = 30;
  const maxFps = $derived(Math.max(FPS_GRAPH_CEILING, ...fpsHistory));
  const points = $derived(
    fpsHistory
      .map((v, i) => `${i},${GRAPH_HEIGHT - (v / maxFps) * GRAPH_HEIGHT}`)
      .join(" "),
  );
</script>

<Button label="spawn cube" onClick={onSpawn} />
<Button label="despawn cube" onClick={onDespawn} />
<Toggle label="heavy-loop" value={heavyLoop} onChange={onHeavyLoopChange} />

<div class="readouts">
  <div><span class="label">cubes</span> <span class="value">{cubeCount}</span></div>
  <div><span class="label">spawn-total</span> <span class="value">{spawnTotal}</span></div>
  <div><span class="label">despawn-total</span> <span class="value">{despawnTotal}</span></div>
  <div><span class="label">heavy ms</span> <span class="value">{heavyMs.toFixed(2)}</span></div>
</div>

<div class="graph">
  <span class="label">fps (last {fpsHistory.length})</span>
  <svg viewBox="0 0 {fpsHistory.length || 1} {GRAPH_HEIGHT}" preserveAspectRatio="none">
    <polyline
      fill="none"
      stroke="var(--accent)"
      stroke-width="0.8"
      points={points}
    />
  </svg>
</div>

<style>
  .readouts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
    margin-top: var(--space-3);
  }
  .readouts div { display: flex; justify-content: space-between; }
  .label { color: var(--text-muted); font-size: 11px; }
  .value { font-family: var(--font-mono); color: var(--accent-warm); font-size: 11px; }
  .graph { margin-top: var(--space-3); }
  .graph svg {
    display: block;
    width: 100%;
    height: 30px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
</style>
