// packages/editor/src/frontend/lib/catalog.ts — the world-materials catalog
// parser. FRONTEND (chrome-bundle) code: imports from @furnace/core MUST be
// `import type` only (erased at compile). A value import would pull a second core
// instance into the chrome bundle — frontend-no-engine-leakage.test.ts enforces
// this. So the table invariants below are RE-IMPLEMENTED locally rather than
// value-importing core's validateMaterialTable.
import type {
  KitStyle,
  MaterialClass,
  MaterialTable,
} from "@furnace/core/field";

/** The catalog-file schema version this parser understands. */
const CATALOG_VERSION = 1;

/**
 * A materials-catalog parse/validation failure. Setup-loud: every failure names
 * the exact offending JSON path (e.g. `classes[3].kit.pieceColors.panel`) so a
 * mistyped catalog fails visibly rather than skinning the world wrong.
 */
export class CatalogError extends Error {
  /** The offending JSON path, e.g. `classes[3].kit.panelProud`. */
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`materials catalog: ${path}: ${detail}`);
    this.name = "CatalogError";
    this.path = path;
  }
}

const num = (v: unknown, path: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new CatalogError(path, "expected a finite number");
  return v;
};

const str = (v: unknown, path: string): string => {
  if (typeof v !== "string" || v.length === 0)
    throw new CatalogError(path, "expected a non-empty string");
  return v;
};

const color4 = (v: unknown, path: string): [number, number, number, number] => {
  if (!Array.isArray(v) || v.length !== 4)
    throw new CatalogError(path, "expected [r,g,b,a]");
  return [num(v[0], path), num(v[1], path), num(v[2], path), num(v[3], path)];
};

const record = (v: unknown, path: string): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new CatalogError(path, "expected an object");
  return v as Record<string, unknown>;
};

const kitStyle = (v: unknown, path: string): KitStyle => {
  // Bracket access: `rec`/`pc` are index-signature records (parsed JSON), so
  // noPropertyAccessFromIndexSignature requires `["key"]` (biome useLiteralKeys off).
  const rec = record(v, path);
  const pc = record(rec["pieceColors"], `${path}.pieceColors`);
  return {
    panelProud: num(rec["panelProud"], `${path}.panelProud`),
    panelReveal: num(rec["panelReveal"], `${path}.panelReveal`),
    collarSection: num(rec["collarSection"], `${path}.collarSection`),
    backingColor: color4(rec["backingColor"], `${path}.backingColor`),
    pieceColors: {
      panel: color4(pc["panel"], `${path}.pieceColors.panel`),
      floor: color4(pc["floor"], `${path}.pieceColors.floor`),
      trim: color4(pc["trim"], `${path}.pieceColors.trim`),
      collar: color4(pc["collar"], `${path}.pieceColors.collar`),
    },
  };
};

const materialClass = (v: unknown, path: string): MaterialClass => {
  const rec = record(v, path);
  const id = num(rec["id"], `${path}.id`);
  const name = str(rec["name"], `${path}.name`);
  const color = color4(rec["color"], `${path}.color`);
  const kind = rec["kind"];
  if (kind !== "organic" && kind !== "kit")
    throw new CatalogError(`${path}.kind`, 'expected "organic" or "kit"');
  if (kind === "organic") return { id, name, kind, color };
  return { id, name, kind, color, kit: kitStyle(rec["kit"], `${path}.kit`) };
};

/**
 * Parses a `catalog/materials.json` text into a validated {@link MaterialTable}.
 * Setup-loud: every structural failure throws a {@link CatalogError} naming the
 * offending JSON path.
 *
 * @throws {@link CatalogError} on malformed JSON, a wrong `version`, a missing or
 *   mistyped field, an empty class list, non-contiguous class ids, or a non-organic
 *   class 0.
 */
export function parseMaterialsCatalog(text: string): MaterialTable {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new CatalogError("", `invalid JSON: ${detail}`);
  }
  const rec = record(root, "");
  const version = num(rec["version"], "version");
  if (version !== CATALOG_VERSION)
    throw new CatalogError(
      "version",
      `unsupported version ${version} (expected ${CATALOG_VERSION})`,
    );
  const rawClasses = rec["classes"];
  if (!Array.isArray(rawClasses))
    throw new CatalogError("classes", "expected an array");
  const classes = rawClasses.map((c, i) => materialClass(c, `classes[${i}]`));

  // Mirror of materials.ts validateMaterialTable — kept in sync by
  // catalog.test.ts (which asserts the same fixtures fail both). Frontend can't
  // value-import core, so the three table invariants are re-implemented here.
  // 1. non-empty  2. ids contiguous from 0  3. class 0 is organic.
  const first = classes[0];
  if (first === undefined)
    throw new CatalogError("classes", "must be non-empty");
  classes.forEach((c, i) => {
    if (c.id !== i)
      throw new CatalogError(
        `classes[${i}].id`,
        `expected ${i} (ids must be contiguous from 0)`,
      );
  });
  if (first.kind !== "organic")
    throw new CatalogError("classes[0].kind", "class 0 must be organic (rock)");

  return { classes };
}
