<script lang="ts">
  import Select from "../../shared/ui/Select.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import type { PipAngle, PipResolution } from "./state.svelte.ts";

  type Props = {
    pipAngle: PipAngle;
    pipResolution: PipResolution;
    pipDepth: boolean;
    onPipAngleChange: (v: PipAngle) => void;
    onPipResolutionChange: (v: PipResolution) => void;
    onPipDepthChange: (v: boolean) => void;
  };
  let {
    pipAngle,
    pipResolution,
    pipDepth,
    onPipAngleChange,
    onPipResolutionChange,
    onPipDepthChange,
  }: Props = $props();

  const isPipAngle = makeUnionGuard<PipAngle>(["overhead", "side", "front"]);
  const isPipResolution = makeUnionGuard<PipResolution>(["256", "512", "1024"]);
</script>

<Select
  label="pipAngle"
  value={pipAngle}
  options={[
    { value: "overhead", label: "overhead" },
    { value: "side", label: "side" },
    { value: "front", label: "front" },
  ]}
  onChange={(v) => { if (isPipAngle(v)) onPipAngleChange(v); }}
/>
<Select
  label="pipResolution"
  value={pipResolution}
  options={[
    { value: "256", label: "256" },
    { value: "512", label: "512" },
    { value: "1024", label: "1024" },
  ]}
  onChange={(v) => { if (isPipResolution(v)) onPipResolutionChange(v); }}
/>
<Toggle label="pipDepth" value={pipDepth} onChange={onPipDepthChange} />
