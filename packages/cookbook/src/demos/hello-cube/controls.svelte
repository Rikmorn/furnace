<script lang="ts">
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

  // Runtime narrowers: Select emits `string`. Project rule forbids `as` casts;
  // type guards re-prove the literal union without bypassing the compiler.
  const CAMERA_KINDS = { perspective: 1, orthographic: 1 } as const;
  const isCameraKind = (v: string): v is CameraKind => v in CAMERA_KINDS;

  const MATERIAL_KINDS = { unlit: 1, normalColor: 1 } as const;
  const isMaterialKind = (v: string): v is MaterialKind => v in MATERIAL_KINDS;
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
