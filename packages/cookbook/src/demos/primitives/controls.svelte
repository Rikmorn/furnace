<script lang="ts">
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import Select from "../../shared/ui/Select.svelte";
  import type { PrimitiveShape } from "./state.svelte.ts";

  type Props = {
    shape: PrimitiveShape;
    onShapeChange: (v: PrimitiveShape) => void;
  };
  let { shape, onShapeChange }: Props = $props();

  const isShape = makeUnionGuard<PrimitiveShape>([
    "cube",
    "plane",
    "sphere",
    "cylinder",
  ]);
</script>

<Select
  label="shape"
  value={shape}
  options={[
    { value: "cube", label: "cube" },
    { value: "plane", label: "plane" },
    { value: "sphere", label: "sphere" },
    { value: "cylinder", label: "cylinder" },
  ]}
  onChange={(v) => { if (isShape(v)) onShapeChange(v); }}
/>
