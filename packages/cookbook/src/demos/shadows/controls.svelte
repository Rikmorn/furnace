<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";

  type LightType = "directional" | "spot";

  type Props = {
    lightType: LightType;
    normalBias: number;
    onLightType: (value: LightType) => void;
    onNormalBias: (value: number) => void;
  };
  let { lightType, normalBias, onLightType, onNormalBias }: Props = $props();
</script>

<Toggle
  label="spot (off = directional)"
  value={lightType === "spot"}
  onChange={(v) => onLightType(v ? "spot" : "directional")}
/>
<Slider label="normalBias" value={normalBias} min={0} max={8} step={0.1} onChange={onNormalBias} />
