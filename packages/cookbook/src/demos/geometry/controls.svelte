<script lang="ts">
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import Select from "../../shared/ui/Select.svelte";
  import Slider from "../../shared/ui/Slider.svelte";
  import type { Topology } from "./state.svelte.ts";

  type Props = {
    topology: Topology;
    subdiv: number;
    amplitude: number;
    onTopologyChange: (v: Topology) => void;
    onSubdivChange: (v: number) => void;
    onAmplitudeChange: (v: number) => void;
  };
  let {
    topology,
    subdiv,
    amplitude,
    onTopologyChange,
    onSubdivChange,
    onAmplitudeChange,
  }: Props = $props();

  const isTopology = makeUnionGuard<Topology>([
    "triangle-list",
    "line-list",
    "point-list",
  ]);
</script>

<Select
  label="topology"
  value={topology}
  options={[
    { value: "triangle-list", label: "triangles" },
    { value: "line-list", label: "lines" },
    { value: "point-list", label: "points" },
  ]}
  onChange={(v) => { if (isTopology(v)) onTopologyChange(v); }}
/>
<Slider label="subdiv" value={subdiv} min={2} max={128} step={1} onChange={onSubdivChange} />
<Slider label="amplitude" value={amplitude} min={0} max={0.8} step={0.01} onChange={onAmplitudeChange} />
