export type LoopKind = "loop" | "fixedLoop";

export const state: {
  rate: number;
  scale: number;
  loopKind: LoopKind;
  angle: number;
} = $state({
  rate: 1.0,
  scale: 1.0,
  loopKind: "loop",
  angle: 0,
});
