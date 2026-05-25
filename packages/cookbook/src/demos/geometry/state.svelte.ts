export type Topology = "triangle-list" | "line-list" | "point-list";

export const state: {
  topology: Topology;
  subdiv: number;
  amplitude: number;
} = $state({
  topology: "triangle-list",
  subdiv: 16,
  amplitude: 0.2,
});
