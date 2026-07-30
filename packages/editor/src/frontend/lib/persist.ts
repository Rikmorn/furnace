// Per-project UI persistence: one JSON blob per project root under a versioned key,
// so the editor's chrome (dockview layout, last scene, view flags…) survives a
// restart. Pure and DOM-free — takes a `Storage` (localStorage in the browser, a fake
// Map-backed Storage in tests). Schema-tolerant by design: a corrupt or missing blob
// reads as an empty state rather than throwing, and a bump of VERSION namespaces a new
// blob so an incompatible old shape is simply ignored (never migrated in place).

/** Bump when the persisted UiState shape changes incompatibly — old blobs are ignored
 *  (their key no longer matches), never migrated. */
const VERSION = 1;

/** The full persisted UI state. Fields are independent — each caller reads/writes its
 *  own key. */
export type UiState = {
  /** dockview serialized layout (SerializedDockview, kept opaque here). */
  layout?: unknown;
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
