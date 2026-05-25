<script lang="ts">
  import Select from "../../shared/ui/Select.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import type { Cull } from "./state.svelte.ts";

  type Props = {
    cull: Cull;
    depthWrite: boolean;
    onCullChange: (v: Cull) => void;
    onDepthWriteChange: (v: boolean) => void;
  };
  let { cull, depthWrite, onCullChange, onDepthWriteChange }: Props = $props();

  const isCull = makeUnionGuard<Cull>(["back", "front", "none"]);
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
