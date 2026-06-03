export type PrimitiveShape = "cube" | "plane" | "sphere" | "cylinder";

export const state: { shape: PrimitiveShape } = $state({ shape: "sphere" });
