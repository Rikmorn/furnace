<script lang="ts">
  import Select from "../../shared/ui/Select.svelte";
  import Slider from "../../shared/ui/Slider.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import type { Backdrop, Cull, DepthCompare } from "./state.svelte.ts";

  type Props = {
    cull: Cull;
    depthWrite: boolean;
    depthCompare: DepthCompare;
    backdrop: Backdrop;
    spread: number;
    onCullChange: (v: Cull) => void;
    onDepthWriteChange: (v: boolean) => void;
    onDepthCompareChange: (v: DepthCompare) => void;
    onBackdropChange: (v: Backdrop) => void;
    onSpreadChange: (v: number) => void;
  };
  let {
    cull,
    depthWrite,
    depthCompare,
    backdrop,
    spread,
    onCullChange,
    onDepthWriteChange,
    onDepthCompareChange,
    onBackdropChange,
    onSpreadChange,
  }: Props = $props();

  const isCull = makeUnionGuard<Cull>(["back", "front", "none"]);
  const isDepthCompare = makeUnionGuard<DepthCompare>([
    "less",
    "less-equal",
    "always",
    "never",
  ]);
  const isBackdrop = makeUnionGuard<Backdrop>([
    "strips",
    "solid-black",
    "solid-white",
  ]);
</script>

<Select
  label="cull"
  value={cull}
  options={[
    { value: "back", label: "back" },
    { value: "front", label: "front" },
    { value: "none", label: "none" },
  ]}
  onChange={(v) => { if (isCull(v)) onCullChange(v); }}
/>
<Toggle label="depthWrite" value={depthWrite} onChange={onDepthWriteChange} />
<Select
  label="depthCompare"
  value={depthCompare}
  options={[
    { value: "less", label: "less" },
    { value: "less-equal", label: "less-equal" },
    { value: "always", label: "always" },
    { value: "never", label: "never" },
  ]}
  onChange={(v) => { if (isDepthCompare(v)) onDepthCompareChange(v); }}
/>
<Select
  label="backdrop"
  value={backdrop}
  options={[
    { value: "strips", label: "strips" },
    { value: "solid-black", label: "solid-black" },
    { value: "solid-white", label: "solid-white" },
  ]}
  onChange={(v) => { if (isBackdrop(v)) onBackdropChange(v); }}
/>
<Slider
  label="spread"
  value={spread}
  min={0}
  max={1}
  step={0.01}
  onChange={onSpreadChange}
/>
