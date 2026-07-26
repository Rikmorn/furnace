import type { FlagKind, FlagSeverity } from "@furnace/core/field";

/** One legend row: a (kind, severity) pair the analyzed chunk actually
 *  produced, with how many cells carry it. Shared by `entry.ts` (which derives
 *  the rows from the flags) and `controls.svelte` (which draws them). */
export type FlagRow = {
  kind: FlagKind;
  severity: FlagSeverity;
  count: number;
  meaning: string;
};

/** What each kind MEANS, straight off the `FlagKind` contract. */
export const FLAG_MEANING: Record<FlagKind, string> = {
  ledge: "neighbour floor higher than stepHeight",
  "lip-near-wall": "sub-step lip with a wall within capsule radius beyond it",
  "low-clearance": "neighbour floor whose headroom is below clearance",
  narrow: "free width at torso height below 2·radius + skin, on one axis",
  pit: "a region the agent can get into and not back out of",
};
