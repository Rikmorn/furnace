<script lang="ts">
  import Panel from "./Panel.svelte";
  import StatsOverlay from "../stats-overlay.svelte";

  type Props = { slug: string };
  let { slug }: Props = $props();
</script>

<Panel
  title="stats"
  keyHint="s"
  anchor="top-right"
  storageKey={`cookbook.${slug}.stats.open`}
  defaultOpen={false}
>
  <StatsOverlay />
</Panel>
