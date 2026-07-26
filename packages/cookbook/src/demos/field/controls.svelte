<script lang="ts">
  import type { FlagRow } from "./flag-legend.ts";

  type Props = {
    chunk: string;
    total: number;
    rows: FlagRow[];
    stepHeight: number;
    climbCeiling: number;
    clearance: number;
    /** CSS colours per severity, derived from the marker tints in `entry.ts` —
     *  passed in rather than restated here so the legend cannot drift from what
     *  the viewport draws. */
    severityCss: Record<FlagRow["severity"], string>;
  };
  let {
    chunk,
    total,
    rows,
    stepHeight,
    climbCeiling,
    clearance,
    severityCss,
  }: Props = $props();
</script>

<p class="lead">
  <code>analyzeChunk</code> on <code>{chunk}</code> → <b>{total}</b> flags.
  Advisory only: nothing here changed the field.
</p>

<p class="agent">
  agent · step {stepHeight.toFixed(2)} m · climb {climbCeiling.toFixed(2)} m ·
  clearance {clearance.toFixed(2)} m
</p>

<ul class="legend">
  {#each rows as row (row.kind + row.severity)}
    <li>
      <span class="swatch" style:background={severityCss[row.severity]}></span>
      <span class="kind">{row.kind}</span>
      <span class="severity" style:color={severityCss[row.severity]}>
        {row.severity}
      </span>
      <span class="count">{row.count}</span>
      <span class="meaning">{row.meaning}</span>
    </li>
  {/each}
</ul>

<style>
  .lead,
  .agent {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.5;
  }
  .agent {
    font-family: var(--font-mono);
    color: var(--text-dim);
  }
  code {
    font-family: var(--font-mono);
    color: var(--text);
  }
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .legend li {
    display: grid;
    grid-template-columns: 10px 1fr auto auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-top: 1px solid var(--border);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .kind {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text);
  }
  .severity {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text);
  }
  .meaning {
    grid-column: 2 / -1;
    font-size: 10px;
    line-height: 1.4;
    color: var(--text-dim);
  }
</style>
