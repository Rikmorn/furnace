// Per-project UI persistence: one JSON blob per project root under a versioned key,
// so the editor's chrome state survives a restart. Pure and DOM-free — takes a `Storage` (localStorage in the browser, a fake
// Map-backed Storage in tests). Schema-tolerant by design: a corrupt or missing blob
// reads as an empty state rather than throwing, and a bump of VERSION namespaces a new
// blob so an incompatible old shape is simply ignored (never migrated in place).

/** Bump when the persisted UiState shape changes incompatibly — old blobs are ignored
 *  (their key no longer matches), never migrated.
 *
 *  v1 → v2 (the overlay shell): the serialized dock `layout` key died with the dock
 *  library. A v1 blob keeps its key and is simply orphaned — a deliberate clean break,
 *  not a migration: nothing in the v1 shape has a v2 meaning. */
const VERSION = 2;

/** One floating palette's placement: viewport-relative position, which edge it is
 *  snapped to (`null` = free-floating), whether its body is rolled up, and whether it
 *  is on screen at all. */
export type PaletteState = {
  x: number;
  y: number;
  edge: "right" | "left" | null;
  collapsed: boolean;
  open: boolean;
};

/** The full persisted UI state. Fields are independent — each caller reads/writes its
 *  own key.
 *
 *  Each key has exactly one writer, and none of them exists yet — this shape is
 *  declared whole so the version bump happens once rather than per key:
 *  - `workspace` — the palette store (drag/snap/collapse/hide-all).
 *  - `view` — the view popover (shading / grid / layer toggles / slice plane).
 *  - `lastWorld` + `recentWorlds` — the world open/save/new flows. */
export type UiState = {
  /** The floating-palette arrangement. `hidden` is the ⌘\ hide-all latch: restoring
   *  must return the EXACT prior arrangement, so the per-palette records survive it
   *  rather than being cleared. */
  workspace?: {
    palettes: Record<string, PaletteState>;
    hidden?: boolean;
  };
  /** Viewport display state — what the field looks like, not what is in it. */
  view?: {
    shading?: "studio" | "normals";
    grid?: boolean;
    layers?: Record<string, boolean>;
    slice?: number | null;
  };
  /** The world the editor had open when it last closed. */
  lastWorld?: string;
  /** Most-recently-opened world names, newest first. */
  recentWorlds?: string[];
};

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
      // properties, so the key is absent from the persisted blob rather than stored as
      // null. That is the delete: callers clear a key by setting it undefined.
      const next = { ...load(), [key]: value };
      try {
        storage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // quota / unavailable storage: drop the write, never throw.
      }
    },
  };
}
