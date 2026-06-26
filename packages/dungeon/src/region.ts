import type { ShapeDescriptor } from "@furnace/core/physics";
import type { MeshData } from "./surface-nets.ts";
import { cave } from "./themes/cave.ts";
import { greatHall } from "./themes/great-hall.ts";
import { pillarHall } from "./themes/pillar-hall.ts";

/** World-space 3-component vector as a tuple. */
export type Vec3 = [number, number, number];

/** The set of named theme generators available in the dungeon. */
export type ThemeName = "cave" | "pillarHall" | "greatHall";

/** RGBA material descriptor for a region mesh surface. */
export type MaterialDescriptor = {
  color: [number, number, number, number];
  specular: [number, number, number, number];
};

/** A single renderable piece of geometry within a region. */
export type RegionMesh = {
  geometry: { custom: MeshData } | { box: Vec3 };
  material: number; // index into RegionData.materials
  position: Vec3; // WORLD position
  scale?: Vec3; // box primitives only
};

/** A single physics collider within a region. */
export type RegionCollider = { shape: ShapeDescriptor; position: Vec3 };

/** Whether a scatter layer's material lights normally or glows (unlit + bloom). */
export type MaterialPosture = "lit" | "emissive";

/** Unit-primitive archetype a scatter layer instances (placed/scaled per instance). */
export type ArchetypeGeometry = { primitive: "cube" | "sphere" | "cylinder" };

/** A theme's declarative rule for one scatter layer; resolved by `scatter()`. */
export type ScatterLayerSpec = {
  /** Stable label → `rng.derive` stream. */
  name: string;
  geometry: ArchetypeGeometry;
  posture: MaterialPosture;
  /** color/specular (lit) or emissive color (unlit). */
  material: MaterialDescriptor;
  target: "floor" | "wall" | "ceiling" | "any";
  spacing: { min: number; max: number };
  scale: { min: number; max: number };
  /** Optional per-instance colour jitter. */
  tint?: { rgb: [number, number, number]; jitter: number };
  /** Field-as-mask, [0,1], default 1. */
  density?: (p: Vec3) => number;
  /** Optional two-level clustering. */
  cluster?: { count: number; radius: number };
};

/** One resolved scatter instance: a seated placement + per-instance variation. */
export type InstanceData = {
  position: Vec3;
  /** Quaternion (x,y,z,w). */
  rotation: [number, number, number, number];
  /** Uniform scalar. */
  scale: number;
  /** RGBA. */
  tint: [number, number, number, number];
};

/** GPU-ready resolved instance group, bucketed by (archetype, posture, material).
 *  `realize` only uploads these — no further computation. */
export type InstanceGroup = {
  geometry: ArchetypeGeometry;
  /** Index into `RegionData.materials`. */
  material: number;
  posture: MaterialPosture;
  /** 16 * n, baked COLUMN-MAJOR mat4 (gl-matrix layout — the layout
   *  `mesh.setInstanceMatrices` consumes). */
  transforms: Float32Array;
  /** 4 * n, RGBA. */
  tints: Float32Array;
};

/** A navigable opening on a region boundary, used to join adjacent regions. */
export type Connection = {
  position: Vec3; // opening centre, on the floor plane
  facing: Vec3; // OUTWARD unit normal; a join pairs facings that negate
  width: number;
  height: number;
  kind: "door" | "tunnel-mouth";
};

/** Immutable record of which generator version produced a region. */
export type Provenance = {
  generatorId: "dungeon";
  generatorVersion: number;
  theme: ThemeName;
  seed: string;
};

/** The full output of a theme generator: geometry, colliders, materials, connections, scatter instances. */
export type RegionData = {
  meshes: RegionMesh[];
  colliders: RegionCollider[];
  materials: MaterialDescriptor[];
  connections: Connection[];
  instances: InstanceGroup[];
  origin: Vec3;
  provenance: Provenance;
};

/** Parameters passed to every theme generator. */
export type RegionParams = { theme: ThemeName; seed: string; origin: Vec3 };

/** Signature all theme generators must satisfy. */
export type ThemeGenerator = (params: RegionParams) => RegionData;

/** Monotonically increasing schema version stamped into every region's provenance. */
export const GENERATOR_VERSION = 2;

/** Map from theme name to its generator function.
 *  All three entries are always present; stub generators return empty RegionData
 *  until their respective Tasks replace them with real implementations. */
export const themes: Record<ThemeName, ThemeGenerator> = {
  cave,
  pillarHall,
  greatHall,
};
