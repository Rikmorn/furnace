<script lang="ts">
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import Select from "../../shared/ui/Select.svelte";
  import Slider from "../../shared/ui/Slider.svelte";
  import type { LoopKind } from "./state.svelte.ts";

  type Props = {
    rate: number;
    scale: number;
    loopKind: LoopKind;
    onRateChange: (v: number) => void;
    onScaleChange: (v: number) => void;
    onLoopChange: (v: LoopKind) => void;
  };
  let {
    rate,
    scale,
    loopKind,
    onRateChange,
    onScaleChange,
    onLoopChange,
  }: Props = $props();

  const isLoopKind = makeUnionGuard<LoopKind>(["loop", "fixedLoop"]);
</script>

<Slider label="rate" value={rate} min={0} max={3} step={0.01} onChange={onRateChange} />
<Slider label="scale" value={scale} min={0.2} max={2} step={0.01} onChange={onScaleChange} />
<Select
  label="loop"
  value={loopKind}
  options={[
    { value: "loop", label: "variable dt" },
    { value: "fixedLoop", label: "fixed 60Hz" },
  ]}
  onChange={(v) => { if (isLoopKind(v)) onLoopChange(v); }}
/>
