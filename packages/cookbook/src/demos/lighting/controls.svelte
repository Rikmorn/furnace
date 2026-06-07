<script lang="ts">
  import Slider from "../../shared/ui/Slider.svelte";
  import Toggle from "../../shared/ui/Toggle.svelte";

  type LightKey = "directional" | "point" | "spot";

  type Props = {
    directional: boolean;
    point: boolean;
    spot: boolean;
    shininess: number;
    onToggle: (key: LightKey, value: boolean) => void;
    onShininess: (value: number) => void;
  };
  let {
    directional,
    point,
    spot,
    shininess,
    onToggle,
    onShininess,
  }: Props = $props();
</script>

<Toggle label="directional" value={directional} onChange={(v) => onToggle("directional", v)} />
<Toggle label="point" value={point} onChange={(v) => onToggle("point", v)} />
<Toggle label="spot" value={spot} onChange={(v) => onToggle("spot", v)} />
<Slider label="shininess" value={shininess} min={1} max={128} step={1} onChange={onShininess} />
