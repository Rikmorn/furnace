import type { ViewFlags } from "../../viewport-host/index.ts"; // type-only: erased

// Per-project UI persistence: one JSON blob per project root under a versioned key,
// so the editor's chrome (dockview layout, last scene, seed history…) survives a
// restart. Pure and DOM-free — takes a `Storage` (localStorage in the browser, a fake
// Map-backed Storage in tests). Schema-tolerant by design: a corrupt or missing blob
// reads as an empty state rather than throwing, and a bump of VERSION namespaces a new
// blob so an incompatible old shape is simply ignored (never migrated in place).

/** Bump when the persisted UiState shape changes incompatibly — old blobs are ignored
 *  (their key no longer matches), never migrated. */
const VERSION = 1;

/** The full persisted UI state. Fields are independent — each caller reads/writes its
 *  own key. Some are wired in Task 6 (layout, lastScene, seedHistory, recentScenes);
 *  cameraByDoc/viewFlags/inspectorCollapse are declared here so the store contract is
 *  complete, but their read/write points land in later tasks (8/9/10). */
export type UiState = {
  /** dockview serialized layout (SerializedDockview, kept opaque here). */
  layout?: unknown;
  lastScene?: string;
  cameraByDoc?: Record<
    string,
    {
      target: [number, number, number];
      distance: number;
      yaw: number;
      pitch: number;
    }
  >;
  // Partial: the store is schema-tolerant and a pre-existing/older blob may carry a subset;
  // App merges over DEFAULT_VIEW_FLAGS on read. Partial states what's actually guaranteed.
  viewFlags?: Partial<ViewFlags>;
  inspectorCollapse?: Record<string, boolean>;
  /** Generation reroll history (most recent first); caller caps at 50 before writing. */
  seedHistory?: { attemptSeed: string; baseSeed: string }[];
  /** Recently opened scenes (most recent first); caller caps at 8 before writing. */
  recentScenes?: string[];
};

/** Viewport view-flag defaults: grid/axes/headlamp ON, fog OFF (a near-black unlit scene
 *  reads as broken otherwise). Seeds App state before the persisted blob is read; the host
 *  carries its own identical internal default for no-opts callers (the GPU tests). */
export const DEFAULT_VIEW_FLAGS: ViewFlags = {
  grid: true,
  axes: true,
  headlamp: true,
  fog: false,
};

/** Prepend `item` to a most-recent-first list, dropping any prior occurrence and capping
 *  the length. Pure — used for the recent-scenes list and unit-tested without a store. */
export function pushRecent(
  list: readonly string[],
  item: string,
  cap: number,
): string[] {
  return [item, ...list.filter((x) => x !== item)].slice(0, cap);
}

/** A namespaced, versioned, schema-tolerant view over a `Storage` for ONE project. */
export type UiStore = {
  get<K extends keyof UiState>(key: K): UiState[K] | undefined;
  set<K extends keyof UiState>(key: K, value: UiState[K]): void;
};

/** Build a UiStore over `storage`, keyed by `projectRoot` so two projects opened in the
 *  same browser never share chrome state. A malformed blob (or `getItem` throwing) reads
 *  as `{}`; a `setItem` failure (quota) is swallowed — persistence is best-effort and must
 *  never break the editor. */
export function createUiStore(storage: Storage, projectRoot: string): UiStore {
  const storageKey = `furnace-editor:v${VERSION}:${projectRoot}`;
  const load = (): UiState => {
    try {
      return JSON.parse(storage.getItem(storageKey) ?? "{}") as UiState;
    } catch {
      return {};
    }
  };
  return {
    get: (key) => load()[key],
    set: (key, value) => {
      // Setting a key to `undefined` REMOVES it: JSON.stringify omits undefined-valued
      // properties, so the key is absent from the persisted blob (relied on by resetLayout).
      const next = { ...load(), [key]: value };
      try {
        storage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // quota / unavailable storage: drop the write, never throw.
      }
    },
  };
}
