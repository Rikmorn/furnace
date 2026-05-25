<script lang="ts">
  import Select from "../../shared/ui/Select.svelte";
  import Slider from "../../shared/ui/Slider.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import type { Backdrop, Cull, DepthCompare, Primitive } from "./state.svelte.ts";

  type Props = {
    cull: Cull;
    depthWrite: boolean;
    depthCompare: DepthCompare;
    backdrop: Backdrop;
    primitive: Primitive;
    showReference: boolean;
    spread: number;
    onCullChange: (v: Cull) => void;
    onDepthWriteChange: (v: boolean) => void;
    onDepthCompareChange: (v: DepthCompare) => void;
    onBackdropChange: (v: Backdrop) => void;
    onPrimitiveChange: (v: Primitive) => void;
    onShowReferenceChange: (v: boolean) => void;
    onSpreadChange: (v: number) => void;
  };
  let {
    cull,
    depthWrite,
    depthCompare,
    backdrop,
    primitive,
    showReference,
    spread,
    onCullChange,
    onDepthWriteChange,
    onDepthCompareChange,
    onBackdropChange,
    onPrimitiveChange,
    onShowReferenceChange,
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
  const isPrimitive = makeUnionGuard<Primitive>(["quad", "cube"]);
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
<Select
  label="primitive"
  value={primitive}
  options={[
    { value: "quad", label: "quad" },
    { value: "cube", label: "cube" },
  ]}
  onChange={(v) => { if (isPrimitive(v)) onPrimitiveChange(v); }}
/>
<Toggle label="showReference" value={showReference} onChange={onShowReferenceChange} />
<Slider
  label="spread"
  value={spread}
  min={0}
  max={1}
  step={0.01}
  onChange={onSpreadChange}
/>
