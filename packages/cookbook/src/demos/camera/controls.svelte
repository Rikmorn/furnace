<script lang="ts">
  import { makeUnionGuard } from "../../shared/type-guards.ts";
  import Select from "../../shared/ui/Select.svelte";
  import Slider from "../../shared/ui/Slider.svelte";
  import type { AnchorPreset, CameraKind, FitPolicyKind } from "./state.svelte.ts";

  type Props = {
    cameraKind: CameraKind;
    fovDeg: number;
    zoom: number;
    near: number;
    far: number;
    fitPolicyKind: FitPolicyKind;
    anchorPreset: AnchorPreset;
    onCameraKindChange: (next: CameraKind) => void;
    onFovDegChange: (next: number) => void;
    onZoomChange: (next: number) => void;
    onNearChange: (next: number) => void;
    onFarChange: (next: number) => void;
    onFitPolicyKindChange: (next: FitPolicyKind) => void;
    onAnchorPresetChange: (next: AnchorPreset) => void;
  };
  let {
    cameraKind,
    fovDeg,
    zoom,
    near,
    far,
    fitPolicyKind,
    anchorPreset,
    onCameraKindChange,
    onFovDegChange,
    onZoomChange,
    onNearChange,
    onFarChange,
    onFitPolicyKindChange,
    onAnchorPresetChange,
  }: Props = $props();

  const isCameraKind = makeUnionGuard<CameraKind>(["perspective", "orthographic"]);
  const isFitPolicyKind = makeUnionGuard<FitPolicyKind>([
    "stretch",
    "preserve-height",
    "preserve-width",
  ]);
  const isAnchorPreset = makeUnionGuard<AnchorPreset>([
    "center",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
  ]);
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
  <Select
    label="fitPolicy"
    value={fitPolicyKind}
    options={[
      { value: "stretch", label: "stretch" },
      { value: "preserve-height", label: "preserve-height" },
      { value: "preserve-width", label: "preserve-width" },
    ]}
    onChange={(v) => { if (isFitPolicyKind(v)) onFitPolicyKindChange(v); }}
  />
  {#if fitPolicyKind !== "stretch"}
    <Select
      label="anchor"
      value={anchorPreset}
      options={[
        { value: "center", label: "center" },
        { value: "top-left", label: "top-left" },
        { value: "top-right", label: "top-right" },
        { value: "bottom-left", label: "bottom-left" },
        { value: "bottom-right", label: "bottom-right" },
      ]}
      onChange={(v) => { if (isAnchorPreset(v)) onAnchorPresetChange(v); }}
    />
  {/if}
{/if}

<Slider label="near" value={near} min={0.05} max={5} step={0.05} onChange={onNearChange} />
<Slider label="far" value={far} min={1} max={20} step={0.5} onChange={onFarChange} />
