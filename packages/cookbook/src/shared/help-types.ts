/**
 * One row in a demo's controls list — exactly one of `key` or `input` is set.
 * `key` = keyboard key; `input` = mouse/pointer/wheel/UI-control label. `action` is the verb-phrase.
 */
export type DemoControl =
  | { key: string; input?: never; action: string }
  | { key?: never; input: string; action: string };

export type DemoHelp = {
  /** Short slug-ish title shown on the menu card and in the help panel. */
  title: string;
  /** One-line blurb (~80 chars). Shown on the menu card. */
  blurb: string;
  /** Optional list of controls. */
  controls?: DemoControl[];
  /** Engine surfaces this demo exercises — short tags shown as feature pills. */
  features: string[];
  /** Honest "what this demo doesn't yet show". Optional. Each entry one line; may include backlog links. */
  gaps?: string[];
  /** Longer explanatory paragraphs. Each entry is one bullet, rendered as a list under a "notes" heading. Use for blend-equation explanations, math derivations, or anything where `features` tags are too short. */
  notes?: string[];
  /** Lower wins. Demos without an order land at end-of-list, then alphabetical. */
  order?: number;
};
