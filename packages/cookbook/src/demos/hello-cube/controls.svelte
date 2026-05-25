<script lang="ts">
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import Select from "../../shared/ui/Select.svelte";

  type CameraKind = "perspective" | "orthographic";
  type MaterialKind = "unlit" | "normalColor";

  type Props = {
    cameraKind: CameraKind;
    materialKind: MaterialKind;
    onCameraChange: (next: CameraKind) => void;
    onMaterialChange: (next: MaterialKind) => void;
  };
  let { cameraKind, materialKind, onCameraChange, onMaterialChange }: Props = $props();

  const isCameraKind = makeUnionGuard<CameraKind>(["perspective", "orthographic"]);
  const isMaterialKind = makeUnionGuard<MaterialKind>(["unlit", "normalColor"]);
</script>

<Select
  label="camera"
  value={cameraKind}
  options={[
    { value: "perspective", label: "perspective" },
    { value: "orthographic", label: "orthographic" },
  ]}
  onChange={(v) => { if (isCameraKind(v)) onCameraChange(v); }}
/>

<Select
  label="material"
  value={materialKind}
  options={[
    { value: "unlit", label: "unlit" },
    { value: "normalColor", label: "normalColor" },
  ]}
  onChange={(v) => { if (isMaterialKind(v)) onMaterialChange(v); }}
/>
