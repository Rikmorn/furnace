<script lang="ts">
  import type { Component } from "svelte";
  import Panel from "./Panel.svelte";

  type Props = {
    slug: string;
    body?: Component<Record<string, unknown>>;
    bodyProps?: Record<string, unknown>;
  };
  let { slug, body, bodyProps = {} }: Props = $props();

  // Aliased to uppercase so Svelte parses `<Body ... />` as a component, not the HTML body element.
  const Body = body;
</script>

<Panel
  title="controls"
  keyHint="c"
  anchor="bottom-right"
  storageKey={`cookbook.${slug}.controls.open`}
  defaultOpen={true}
>
  {#if Body}
    <Body {...bodyProps} />
  {/if}
</Panel>
