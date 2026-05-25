<script lang="ts">
  import Panel from "./Panel.svelte";
  import type { Snippet } from "svelte";

  type Props = { slug: string; children?: Snippet };
  let { slug, children }: Props = $props();
</script>

<Panel
  title="controls"
  keyHint="c"
  anchor="bottom-right"
  storageKey={`cookbook.${slug}.controls.open`}
  defaultOpen={true}
>
  {@render children?.()}
</Panel>
