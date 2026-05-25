export type DemoControl = {
  /** Keyboard key. Mutually optional with `input`. */
  key?: string;
  /** Mouse/pointer/wheel/UI-control label. Mutually optional with `key`. */
  input?: string;
  /** Short verb-phrase describing what this control does. */
  action: string;
};

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
  /** Lower wins. Demos without an order land at end-of-list, then alphabetical. */
  order?: number;
};
