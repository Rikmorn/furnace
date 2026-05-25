<script lang="ts">
  import Panel from "./Panel.svelte";
  import type { DemoHelp } from "../help-types.ts";

  type Props = { slug: string; help: DemoHelp };
  let { slug, help }: Props = $props();
</script>

<Panel
  title={help.title}
  keyHint="h"
  anchor="bottom-left"
  storageKey={`cookbook.${slug}.help.open`}
  defaultOpen={true}
>
  <p class="blurb">{help.blurb}</p>

  {#if help.controls && help.controls.length > 0}
    <h4>controls</h4>
    <ul class="controls">
      {#each help.controls as ctrl}
        <li>
          {#if ctrl.key}<span class="key">{ctrl.key}</span>{/if}
          {#if ctrl.input}<span class="input">{ctrl.input}</span>{/if}
          <span class="action">{ctrl.action}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if help.notes && help.notes.length > 0}
    <h4>notes</h4>
    <ul class="notes">
      {#each help.notes as note}<li>{note}</li>{/each}
    </ul>
  {/if}

  <h4>features</h4>
  <div class="features">
    {#each help.features as feat}
      <span class="feature">{feat}</span>
    {/each}
  </div>

  {#if help.gaps && help.gaps.length > 0}
    <h4>gaps</h4>
    <ul class="gaps">
      {#each help.gaps as gap}<li>{gap}</li>{/each}
    </ul>
  {/if}
</Panel>

<style>
  .blurb {
    margin: 0 0 var(--space-3);
    color: var(--text);
  }
  h4 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .controls li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }
  .key, .input {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 1px 6px;
    flex-shrink: 0;
  }
  .input { color: var(--accent-warm); }
  .action { color: var(--text-muted); }
  .features {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .feature {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent-warm);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 2px var(--space-2);
  }
  .gaps li {
    color: var(--text-muted);
    margin-bottom: var(--space-1);
    padding-left: var(--space-3);
    position: relative;
  }
  .gaps li::before {
    content: "•";
    position: absolute;
    left: 0;
    color: var(--text-dim);
  }
  .notes li {
    color: var(--text-muted);
    margin-bottom: var(--space-2);
    padding-left: var(--space-3);
    position: relative;
    line-height: 1.5;
  }
  .notes li::before {
    content: "•";
    position: absolute;
    left: 0;
    color: var(--text-dim);
  }
</style>
