import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { KitStyle, MaterialTable } from "@furnace/core/field";
// Tests are NOT part of the chrome bundle, so a VALUE import of core is allowed
// here — it is exactly what proves the frontend parser's LOCAL validation twin
// stays in sync with core's validateMaterialTable.
import { validateMaterialTable } from "@furnace/core/field";
import {
  CatalogError,
  parseMaterialsCatalog,
} from "../src/frontend/lib/catalog.ts";

// The exact catalog data the dungeon ships (packages/dungeon/catalog/materials.json).
// A separate test reads the real file and asserts it parses+validates, guarding
// against this inline fixture drifting from the shipped artifact.
const VALID = JSON.stringify({
  version: 1,
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.62, 0.6, 0.58, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.45, 0.36, 0.26, 1] },
    {
      id: 2,
      name: "moss-stone",
      kind: "organic",
      color: [0.38, 0.52, 0.42, 1],
    },
    {
      id: 3,
      name: "masonry",
      kind: "kit",
      color: [0.55, 0.53, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.34, 0.32, 0.3, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
});

/** Parse `text`, expecting a CatalogError; return it so `.path` can be asserted. */
function parseError(text: string): CatalogError {
  try {
    parseMaterialsCatalog(text);
  } catch (e) {
    if (e instanceof CatalogError) return e;
    throw e;
  }
  throw new Error("expected parseMaterialsCatalog to throw a CatalogError");
}

// Loose mutable shape for the negative cases — named fields (not an index
// signature) so the mutation callbacks read as plain property access.
type MutableClass = {
  id?: number;
  name?: string;
  kind?: string;
  color?: unknown;
  kit?: unknown;
};
type MutableCatalog = { version: number; classes: MutableClass[] };

/** JSON round-trip so each negative case mutates a fresh copy of the fixture. */
function mutate(fn: (root: MutableCatalog) => void): string {
  const root = JSON.parse(VALID) as MutableCatalog;
  fn(root);
  return JSON.stringify(root);
}

describe("parseMaterialsCatalog", () => {
  test("valid catalog parses to a table core's validator accepts", () => {
    const table = parseMaterialsCatalog(VALID);
    expect(() => validateMaterialTable(table)).not.toThrow();
    expect(table.classes.length).toBe(4);
  });

  test("masonry class carries its kit blob with the ported numbers", () => {
    const table = parseMaterialsCatalog(VALID);
    const masonry = table.classes[3];
    expect(masonry?.kind).toBe("kit");
    if (masonry?.kind !== "kit") throw new Error("masonry must be a kit class");
    expect(masonry.kit.panelProud).toBe(0.06);
    expect(masonry.kit.panelReveal).toBe(0.02);
    expect(masonry.kit.collarSection).toBe(0.14);
    expect(masonry.kit.backingColor).toEqual([0.34, 0.32, 0.3, 1]);
    expect(masonry.kit.pieceColors.panel).toEqual([0.55, 0.53, 0.5, 1]);
    expect(masonry.kit.pieceColors.floor).toEqual([0.42, 0.4, 0.38, 1]);
    expect(masonry.kit.pieceColors.trim).toEqual([0.35, 0.33, 0.3, 1]);
    expect(masonry.kit.pieceColors.collar).toEqual([0.3, 0.28, 0.26, 1]);
  });

  test("the shipped dungeon catalog parses and validates", async () => {
    const path = join(
      import.meta.dir,
      "..",
      "..",
      "dungeon",
      "catalog",
      "materials.json",
    );
    const text = await Bun.file(path).text();
    const table = parseMaterialsCatalog(text);
    expect(() => validateMaterialTable(table)).not.toThrow();
    expect(table.classes.map((c) => c.name)).toEqual([
      "rock",
      "dirt",
      "moss-stone",
      "masonry",
    ]);
  });

  test("kit class missing kit.panelProud throws naming the path", () => {
    const text = mutate((root) => {
      const kit = root.classes[3]?.kit as { panelProud?: number };
      delete kit.panelProud;
    });
    const err = parseError(text);
    expect(err.path).toContain("classes[3].kit.panelProud");
  });

  test("kit class with no kit blob throws naming the path", () => {
    const text = mutate((root) => {
      delete root.classes[3]?.kit;
    });
    const err = parseError(text);
    expect(err.path).toContain("classes[3].kit");
  });

  test("non-contiguous ids throw (contiguity invariant)", () => {
    const text = mutate((root) => {
      // ids become [0,1,2,4] — index 3 no longer matches its id.
      const c = root.classes[3];
      if (c) c.id = 4;
    });
    const err = parseError(text);
    expect(err.path).toContain("classes[3]");
  });

  test("empty classes throw (non-empty invariant)", () => {
    const err = parseError(JSON.stringify({ version: 1, classes: [] }));
    expect(err.path).toContain("classes");
  });

  test("valid-but-non-organic class 0 fails the class-0-organic invariant", () => {
    // Give class 0 the masonry kit blob so per-class validation PASSES — the
    // rejection must then come from the local class-0-organic invariant (the
    // mirror of core's validateMaterialTable), naming classes[0].kind.
    const text = mutate((root) => {
      const zero = root.classes[0];
      const masonry = root.classes[3];
      if (zero && masonry) {
        zero.kind = "kit";
        zero.kit = masonry.kit;
      }
    });
    const err = parseError(text);
    expect(err.path).toBe("classes[0].kind");
  });

  test("bad color arity throws naming the color path", () => {
    const text = mutate((root) => {
      const c = root.classes[1];
      if (c) c.color = [0.1, 0.2, 0.3];
    });
    const err = parseError(text);
    expect(err.path).toContain("classes[1].color");
  });

  test("malformed JSON throws a CatalogError, never a raw SyntaxError", () => {
    const err = parseError("{ not json");
    expect(err).toBeInstanceOf(CatalogError);
  });
});

// Negative-direction parity: catalog.ts RE-IMPLEMENTS core's three table
// invariants locally (the frontend can't value-import core). These build invalid
// MaterialTable objects DIRECTLY and prove core's validateMaterialTable rejects the
// SAME three cases the parser does — if core ever drifted looser, the twin claim in
// catalog.ts would become a lie and these tests would catch it.
describe("validateMaterialTable twin parity", () => {
  const kit: KitStyle = {
    panelProud: 0.06,
    panelReveal: 0.02,
    collarSection: 0.14,
    backingColor: [0.34, 0.32, 0.3, 1],
    pieceColors: {
      panel: [0.55, 0.53, 0.5, 1],
      floor: [0.42, 0.4, 0.38, 1],
      trim: [0.35, 0.33, 0.3, 1],
      collar: [0.3, 0.28, 0.26, 1],
    },
  };

  test("core rejects an empty table (non-empty invariant)", () => {
    const empty: MaterialTable = { classes: [] };
    expect(() => validateMaterialTable(empty)).toThrow();
  });

  test("core rejects non-contiguous ids (contiguity invariant)", () => {
    const table: MaterialTable = {
      classes: [
        { id: 0, name: "rock", kind: "organic", color: [0.62, 0.6, 0.58, 1] },
        { id: 2, name: "dirt", kind: "organic", color: [0.45, 0.36, 0.26, 1] },
      ],
    };
    expect(() => validateMaterialTable(table)).toThrow();
  });

  test("core rejects a non-organic class 0 (class-0-organic invariant)", () => {
    // Valid kit blob → per-class shape is fine, so only the organic invariant trips.
    const table: MaterialTable = {
      classes: [
        {
          id: 0,
          name: "masonry",
          kind: "kit",
          color: [0.55, 0.53, 0.5, 1],
          kit,
        },
      ],
    };
    expect(() => validateMaterialTable(table)).toThrow();
  });
});
