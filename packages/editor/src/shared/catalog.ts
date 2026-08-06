// The project catalog parsers: `catalog/materials.json` (the resolved material
// table), `catalog/entities.json` (the placement archetypes scatter draws from)
// and `catalog/agent.json` (the capsule the walkability advisor is parameterized
// on).
// `src/shared/` code, and the chrome VALUE-imports it (`hooks/useCatalogs.tsx`),
// so it is bound by the chrome's rule: imports from @furnace/core MUST be
// `import type` only (erased at compile). A value import would pull a second core
// instance into the chrome bundle — frontend-no-engine-leakage.test.ts enforces
// this, scanning `src/shared/` with the same rules it applies to the chrome and
// with no exemptions. So the table invariants below are RE-IMPLEMENTED locally
// rather than value-importing core's validateMaterialTable.
import type {
  AgentProfile,
  KitStyle,
  MaterialClass,
  MaterialTable,
} from "@furnace/core/field";

/** The catalog-file schema version this parser understands. */
const CATALOG_VERSION = 1;

/** The three catalog files, as their thrown messages name them. */
const MATERIALS_LABEL = "materials catalog";
const ENTITY_LABEL = "entity catalog";
const AGENT_LABEL = "agent catalog";

/**
 * A catalog parse/validation failure (materials, entities or agent). Setup-loud:
 * every failure names the exact offending JSON path (e.g.
 * `classes[3].kit.pieceColors.panel`) so a mistyped catalog fails visibly rather
 * than skinning the world wrong.
 */
export class CatalogError extends Error {
  /** The offending JSON path, e.g. `classes[3].kit.panelProud`. */
  readonly path: string;
  constructor(path: string, detail: string, label = MATERIALS_LABEL) {
    super(`${label}: ${path}: ${detail}`);
    this.name = "CatalogError";
    this.path = path;
  }
}

/** The primitive parsers BOUND to one catalog file's label. Bound rather than
 *  taking the label per call: an optional per-call label is a footgun in a file
 *  that parses three different catalogs — every call site has to remember it,
 *  and a forgotten one silently blames the wrong FILE, which is exactly the
 *  diagnostic the label exists to give. Each parser below is destructured from
 *  one of these, so the label is chosen once per catalog and cannot drift. */
const parsersFor = (label: string) => ({
  num: (v: unknown, path: string): number => {
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new CatalogError(path, "expected a finite number", label);
    return v;
  },
  str: (v: unknown, path: string): string => {
    if (typeof v !== "string" || v.length === 0)
      throw new CatalogError(path, "expected a non-empty string", label);
    return v;
  },
  /** A CatalogError already blaming this file — so an entity-section throw can
   *  never fall back to the materials label. */
  err: (path: string, detail: string): CatalogError =>
    new CatalogError(path, detail, label),
  record: (v: unknown, path: string): Record<string, unknown> => {
    if (typeof v !== "object" || v === null || Array.isArray(v))
      throw new CatalogError(path, "expected an object", label);
    // Boundary cast: parsed JSON of unknown shape; the runtime check above
    // proves it is a non-null non-array object, which is always index-readable
    // as a record (values stay unknown).
    return v as Record<string, unknown>;
  },
});

const { num, str, record } = parsersFor(MATERIALS_LABEL);

const color4 = (v: unknown, path: string): [number, number, number, number] => {
  if (!Array.isArray(v) || v.length !== 4)
    throw new CatalogError(path, "expected [r,g,b,a]");
  return [num(v[0], path), num(v[1], path), num(v[2], path), num(v[3], path)];
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

// ─── the entity catalog (catalog/entities.json) ───

// The entity file's own bound parsers — `num`/`str`/`record` above are bound to
// the MATERIALS label and must never be used below this line.
const {
  num: entityNum,
  str: entityStr,
  record: entityRecord,
  err: entityErr,
} = parsersFor(ENTITY_LABEL);

/** Where a record's `position` sits on its collision primitive (D-F4-14):
 *  `"center"` (the default, and every pre-F4 catalog's implicit meaning) at the
 *  primitive's middle, `"base"` at its bottom — what a prop authored to stand on
 *  the floor wants. Structurally core's `PlacementCollision["anchor"]`. */
export type EntityAnchor = "center" | "base";

/** An archetype's collision primitive, as `catalog/entities.json` declares it —
 *  the same three kinds the dungeon's field-world loader derives static colliders
 *  from (D-F3-10). The EDITOR reads it as a proxy SIZE: it draws each placed prop
 *  as this primitive rather than loading the archetype's `.fmesh` variants.
 *
 *  Structurally assignable to core's `PlacementCollision`, which is what lets the
 *  proxy math hand one straight to `collisionCenter` instead of re-deriving the
 *  anchored pose. Keep the two in step. */
export type EntityCollision =
  | {
      kind: "box";
      halfExtents: [number, number, number];
      anchor?: EntityAnchor;
    }
  | { kind: "sphere"; radius: number; anchor?: EntityAnchor }
  | {
      kind: "capsule";
      halfHeight: number;
      radius: number;
      anchor?: EntityAnchor;
    };

/** One placement archetype as the EDITOR consumes it: its id (what a core
 *  `PlacementRecord`'s `archetypeId` names), a display name, the lit colour
 *  its proxies tint with, its collision primitive (the proxy size), and the
 *  scatter param defaults it seeds a stamp session with — already mapped to the
 *  SCATTER GENERATOR's param spelling (`scaleRange` → `scaleMin`/`scaleMax`), so
 *  the host can spread it straight over the schema defaults. The catalog's mesh
 *  paths are deliberately NOT carried: editor props are proxies (see
 *  `docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Editor props render as
 *  collision PROXIES, not the archetype's actual meshes*). */
export type EntityArchetype = {
  id: string;
  name: string;
  color: [number, number, number];
  collision: EntityCollision;
  scatter: Record<string, unknown>;
};

/** The parsed `catalog/entities.json`. */
export type EntityCatalog = { archetypes: EntityArchetype[] };

const color3 = (v: unknown, path: string): [number, number, number] => {
  if (!Array.isArray(v) || v.length !== 3)
    throw entityErr(path, "expected [r,g,b]");
  return [entityNum(v[0], path), entityNum(v[1], path), entityNum(v[2], path)];
};

/** The optional `anchor`, as a SPREADABLE fragment — so an absent one stays
 *  absent rather than becoming an explicit `"center"`. That matters: core reads a
 *  missing anchor as centred, and spelling it in would make every pre-F4 catalog
 *  parse to a different object than it did before for no behavioural gain. */
const entityAnchor = (v: unknown, path: string): { anchor?: EntityAnchor } => {
  if (v === undefined) return {};
  if (v !== "center" && v !== "base")
    throw entityErr(path, 'expected "center" or "base"');
  return { anchor: v };
};

const entityCollision = (v: unknown, path: string): EntityCollision => {
  const rec = entityRecord(v, path);
  const kind = rec["kind"];
  // Every key this parser does not name is DROPPED — it is a whitelist, not a
  // passthrough — so `anchor` has to be carried explicitly on all three kinds or
  // the editor draws a base-anchored prop's proxy half-buried while the runtime
  // stands its collider up (D-F4-14).
  const anchor = entityAnchor(rec["anchor"], `${path}.anchor`);
  if (kind === "box") {
    const he = rec["halfExtents"];
    if (!Array.isArray(he) || he.length !== 3)
      throw entityErr(`${path}.halfExtents`, "expected [x,y,z]");
    return {
      kind,
      halfExtents: [
        entityNum(he[0], `${path}.halfExtents`),
        entityNum(he[1], `${path}.halfExtents`),
        entityNum(he[2], `${path}.halfExtents`),
      ],
      ...anchor,
    };
  }
  if (kind === "sphere")
    return {
      kind,
      radius: entityNum(rec["radius"], `${path}.radius`),
      ...anchor,
    };
  if (kind === "capsule")
    return {
      kind,
      halfHeight: entityNum(rec["halfHeight"], `${path}.halfHeight`),
      radius: entityNum(rec["radius"], `${path}.radius`),
      ...anchor,
    };
  throw entityErr(`${path}.kind`, 'expected "box" | "sphere" | "capsule"');
};

/** Catalog `scatter` key → scatter-generator param key, for the keys that carry
 *  straight through. `scaleRange` is the ONE re-shaping (a `[min, max]` pair vs
 *  the generator's two scalars) and is handled separately. */
const SCATTER_PASSTHROUGH = [
  "density",
  "minSpacing",
  "randomYaw",
  "orientation",
  "hemisphere",
  "variants",
] as const;

/** An archetype's authoring hints as SCATTER PARAMS. Every key is OPTIONAL —
 *  the catalog SEEDS the stamp form, it never gates it, so a missing block or a
 *  missing key simply leaves the generator's own schema default standing. Values
 *  are carried through unvalidated-by-type on purpose: the scatter generator's
 *  own setup-loud param validation is the authority, and duplicating its ranges
 *  here would be a second source of truth that can disagree. `scaleRange` is
 *  re-shaped into `scaleMin`/`scaleMax`. */
const scatterHints = (v: unknown, path: string): Record<string, unknown> => {
  if (v === undefined) return {};
  const rec = entityRecord(v, path);
  const out: Record<string, unknown> = {};
  for (const key of SCATTER_PASSTHROUGH)
    if (rec[key] !== undefined) out[key] = rec[key];
  const range = rec["scaleRange"];
  if (range !== undefined) {
    if (!Array.isArray(range) || range.length !== 2)
      throw entityErr(`${path}.scaleRange`, "expected [min,max]");
    out["scaleMin"] = entityNum(range[0], `${path}.scaleRange`);
    out["scaleMax"] = entityNum(range[1], `${path}.scaleRange`);
  }
  return out;
};

const entityArchetype = (v: unknown, path: string): EntityArchetype => {
  const rec = entityRecord(v, path);
  const id = entityStr(rec["id"], `${path}.id`);
  const material = entityRecord(rec["material"], `${path}.material`);
  return {
    id,
    // `name` is the label a palette shows; absent falls back to the id rather
    // than failing a catalog whose consumer (the dungeon loader) never reads it.
    name:
      rec["name"] === undefined ? id : entityStr(rec["name"], `${path}.name`),
    color: color3(material["litColor"], `${path}.material.litColor`),
    collision: entityCollision(rec["collision"], `${path}.collision`),
    scatter: scatterHints(rec["scatter"], `${path}.scatter`),
  };
};

/**
 * Parses a `catalog/entities.json` text into the archetypes the editor's
 * placement authoring reads. Setup-loud: every structural failure throws a
 * {@link CatalogError} naming the offending JSON path — a mistyped catalog fails
 * visibly rather than silently sizing every prop proxy wrong.
 *
 * ABSENCE is not a failure: a project with no entity catalog never calls this,
 * and the host falls back to schema defaults + a generic proxy box (the catalog
 * seeds, it never gates).
 *
 * @throws {@link CatalogError} on malformed JSON, a wrong `version`, a
 *   non-array `archetypes`, a duplicate archetype id, or a missing/mistyped
 *   `id` / `material.litColor` / `collision` on any archetype.
 */
export function parseEntityCatalog(text: string): EntityCatalog {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw entityErr("", `invalid JSON: ${detail}`);
  }
  const rec = entityRecord(root, "");
  const version = entityNum(rec["version"], "version");
  if (version !== CATALOG_VERSION)
    throw entityErr(
      "version",
      `unsupported version ${version} (expected ${CATALOG_VERSION})`,
    );
  const raw = rec["archetypes"];
  if (!Array.isArray(raw)) throw entityErr("archetypes", "expected an array");
  const archetypes = raw.map((a, i) => entityArchetype(a, `archetypes[${i}]`));
  // Ids key the host's lookup map AND the archetypeId enum — a duplicate would
  // silently shadow one archetype's proxy + hints with another's.
  const seen = new Set<string>();
  archetypes.forEach((a, i) => {
    if (seen.has(a.id))
      throw entityErr(
        `archetypes[${i}].id`,
        `duplicate archetype id "${a.id}"`,
      );
    seen.add(a.id);
  });
  return { archetypes };
}

// ─── the agent catalog (catalog/agent.json) ───

// The agent file's own bound parsers — the two sets above belong to the other
// catalogs' labels and must never be used below this line.
const {
  num: agentNum,
  record: agentRecord,
  err: agentErr,
} = parsersFor(AGENT_LABEL);

/**
 * Parses a `catalog/agent.json` text into the {@link AgentProfile} the
 * walkability advisor is parameterized on (D-F4-4).
 *
 * STRUCTURAL validation only, and deliberately: every field must be present and
 * a finite number, but the numeric CONTRACT — positivity, `climbCeiling >
 * stepHeight`, `clearance` at least the capsule's own height, `skin` below the
 * capsule radius — belongs to core's `assertAgentProfileValid`, which every
 * analyzer pass runs and which reports through the worker's typed error channel.
 * Restating those relations here would be a second source of truth that can
 * disagree with the gate that actually decides (the same trade `scatterHints`
 * makes with the scatter generator's param ranges).
 *
 * ABSENCE is not a failure: a project with no agent catalog never calls this,
 * and the host simply leaves the advisor off — saying so once, loudly, at the
 * first edit that would have analysed.
 *
 * @throws {@link CatalogError} on malformed JSON, a wrong `version`, or a
 *   missing/mistyped `capsule.radius` / `capsule.halfHeight` / `stepHeight` /
 *   `climbCeiling` / `clearance` / `slopeLimitDeg` / `skin`.
 */
export function parseAgentCatalog(text: string): AgentProfile {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw agentErr("", `invalid JSON: ${detail}`);
  }
  const rec = agentRecord(root, "");
  const version = agentNum(rec["version"], "version");
  if (version !== CATALOG_VERSION)
    throw agentErr(
      "version",
      `unsupported version ${version} (expected ${CATALOG_VERSION})`,
    );
  const capsule = agentRecord(rec["capsule"], "capsule");
  return {
    capsule: {
      radius: agentNum(capsule["radius"], "capsule.radius"),
      halfHeight: agentNum(capsule["halfHeight"], "capsule.halfHeight"),
    },
    stepHeight: agentNum(rec["stepHeight"], "stepHeight"),
    climbCeiling: agentNum(rec["climbCeiling"], "climbCeiling"),
    clearance: agentNum(rec["clearance"], "clearance"),
    slopeLimitDeg: agentNum(rec["slopeLimitDeg"], "slopeLimitDeg"),
    skin: agentNum(rec["skin"], "skin"),
  };
}
