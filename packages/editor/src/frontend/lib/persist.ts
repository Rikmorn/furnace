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
 *  own key, and each key has exactly one writer:
 *  - `workspace` — the palette store (drag/snap/collapse/hide-all).
 *  - `view` — the view popover's display state (`hooks/useView.tsx`).
 *  - `flagFilters` — the advisor's triage bands (`hooks/useFieldHostState.tsx`).
 *  - `lastWorld` + `recentWorlds` — the world save/load flows (`world-actions.ts`'s
 *    `rememberWorld`). */
export type UiState = {
  /** The floating-palette arrangement. `hidden` is the ⌘\ hide-all latch: restoring
   *  must return the EXACT prior arrangement, so the per-palette records survive it
   *  rather than being cleared. */
  workspace?: {
    palettes: Record<string, PaletteState>;
    hidden?: boolean;
  };
  /** Viewport display state — what the field looks like, not what is in it. The grid is
   *  a LAYER (`layers.grid`), not a key of its own: two ways to spell one toggle is two
   *  things to keep in agreement. `slice` is the clip plane in metres, `null` = off.
   *  Viewport AA is deliberately absent — see `serializeView`. */
  view?: {
    shading?: "studio" | "normals";
    layers?: Record<string, boolean>;
    slice?: number | null;
  };
  /** Which of the advisor's triage bands the Flags palette asks for (D-F4.5-3's
   *  "widget state (flag filters included)"). A record of booleans rather than the
   *  `FlagFilters` type itself: this module is pure chrome and must not type-import
   *  anything under `viewport-host/`, and the restore has to be schema-tolerant
   *  anyway — a band that was renamed or retired is simply not adopted.
   *
   *  Its own key rather than a field inside `workspace`, even though D-3 calls it
   *  one blob: the blob is the localStorage RECORD, and every key in it has exactly
   *  one writer (see above). `workspace` is the palette store's; the filters are the
   *  host-state provider's, which is where the state and its push to the host live.
   *  Sharing a key would be two writers racing a debounce. */
  flagFilters?: Record<string, boolean>;
  /** The world the editor had open when it last closed. */
  lastWorld?: string;
  /** Most-recently-opened world names, newest first. */
  recentWorlds?: string[];
};

/** Prepend `item` to a most-recent-first list, dropping any prior occurrence and capping
 *  the length. Pure — the recents list is a value, so its rules are testable without a
 *  store. */
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
