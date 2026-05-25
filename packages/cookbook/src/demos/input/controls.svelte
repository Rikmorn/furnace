<script lang="ts">
  type Props = {
    keys: string[];
    pointer: { x: number; y: number; buttons: string[] };
    wheelDeltaY: number;
  };
  let { keys, pointer, wheelDeltaY }: Props = $props();
</script>

<div class="live">
  <h4>keys</h4>
  <p class="mono">{keys.length > 0 ? keys.join(" ") : "—"}</p>
  <h4>pointer</h4>
  <p class="mono">x={pointer.x.toFixed(0)} y={pointer.y.toFixed(0)} {pointer.buttons.length > 0 ? pointer.buttons.join(" ") : "—"}</p>
  <h4>wheel ΔY</h4>
  <p class="mono">{wheelDeltaY.toFixed(0)}</p>
</div>

<style>
  h4 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  p {
    margin: 0;
    color: var(--accent-warm);
    font-size: 12px;
  }
</style>
