export const chargeMeter = $state<{
  charge: number;
  phase: "aiming" | "rolling";
}>({
  charge: 0,
  phase: "aiming",
});
