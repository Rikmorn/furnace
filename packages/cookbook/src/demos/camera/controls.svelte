<script lang="ts">
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import Select from "../../shared/ui/Select.svelte";
  import Slider from "../../shared/ui/Slider.svelte";
  import type { CameraKind } from "./state.svelte.ts";

  type Props = {
    cameraKind: CameraKind;
    fovDeg: number;
    zoom: number;
    near: number;
    far: number;
    onCameraKindChange: (next: CameraKind) => void;
    onFovDegChange: (next: number) => void;
    onZoomChange: (next: number) => void;
    onNearChange: (next: number) => void;
    onFarChange: (next: number) => void;
  };
  let {
    cameraKind,
    fovDeg,
    zoom,
    near,
    far,
    onCameraKindChange,
    onFovDegChange,
    onZoomChange,
    onNearChange,
    onFarChange,
  }: Props = $props();

  const isCameraKind = makeUnionGuard<CameraKind>(["perspective", "orthographic"]);
</script>

<Select
  label="cameraKind"
  value={cameraKind}
  options={[
    { value: "perspective", label: "perspective" },
    { value: "orthographic", label: "orthographic" },
  ]}
  onChange={(v) => { if (isCameraKind(v)) onCameraKindChange(v); }}
/>

{#if cameraKind === "perspective"}
  <Slider label="fov" value={fovDeg} min={20} max={120} step={1} onChange={onFovDegChange} />
{:else}
  <Slider label="zoom" value={zoom} min={0.5} max={6} step={0.1} onChange={onZoomChange} />
{/if}

<Slider label="near" value={near} min={0.05} max={5} step={0.05} onChange={onNearChange} />
<Slider label="far" value={far} min={1} max={20} step={0.5} onChange={onFarChange} />
