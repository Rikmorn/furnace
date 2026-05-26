import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { checkTsdocForModule } from "./tsdoc-check.ts";

function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(resolve(tmpdir(), "tsdoc-check-"));
  for (const [path, content] of Object.entries(files)) {
    const full = resolve(root, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

describe("checkTsdocForModule", () => {
  test("reports an export whose declaration lacks TSDoc", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo } from "./impl.ts";\n`,
      "impl.ts": `export function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.exportName).toBe("foo");
      expect(violations[0]?.declarationFile.endsWith("impl.ts")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("accepts an export whose declaration has TSDoc", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo } from "./impl.ts";\n`,
      "impl.ts": `/**\n * Documented.\n */\nexport function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("skips _-prefixed exports", () => {
    const root = makeWorkspace({
      "index.ts": `export { _internal, foo } from "./impl.ts";\n`,
      "impl.ts": `export function _internal(): void {}\nexport function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.exportName).toBe("foo");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports type-only exports lacking TSDoc", () => {
    const root = makeWorkspace({
      "index.ts": `export type { Foo } from "./impl.ts";\n`,
      "impl.ts": `export type Foo = { x: number };\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.exportName).toBe("Foo");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports aliased exports by their alias name", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo as bar } from "./impl.ts";\n`,
      "impl.ts": `export function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.exportName).toBe("bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("accepts aliased export when the underlying declaration is documented", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo as bar } from "./impl.ts";\n`,
      "impl.ts": `/**\n * Documented.\n */\nexport function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("handles inline exports in the same file (no re-export specifier)", () => {
    const root = makeWorkspace({
      "index.ts": `export function foo(): void {}\n/**\n * Documented.\n */\nexport function bar(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.exportName).toBe("foo");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("handles multiple identifiers per export clause", () => {
    const root = makeWorkspace({
      "index.ts": `export { a, b, c } from "./impl.ts";\n`,
      "impl.ts": `export const a = 1;\n/**\n * Doc.\n */\nexport const b = 2;\nexport const c = 3;\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations.map((v) => v.exportName).sort()).toEqual(["a", "c"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("handles const, class, type, interface, and namespace declarations", () => {
    const root = makeWorkspace({
      "index.ts": `export { aFunc, AClass, AConst, AType, AInterface } from "./impl.ts";\n`,
      "impl.ts": `export function aFunc(): void {}\nexport class AClass {}\nexport const AConst = 1;\nexport type AType = number;\nexport interface AInterface { x: number }\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations.map((v) => v.exportName).sort()).toEqual([
        "AClass",
        "AConst",
        "AInterface",
        "AType",
        "aFunc",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("includes line number of the declaration in the violation", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo } from "./impl.ts";\n`,
      "impl.ts": `// header comment\n// another\nexport function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.line).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("chases re-export chains across multiple files (X -> Y -> Z)", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo } from "./hop1.ts";\n`,
      "hop1.ts": `export { foo } from "./hop2.ts";\n`,
      "hop2.ts": `export function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.exportName).toBe("foo");
      expect(violations[0]?.declarationFile.endsWith("hop2.ts")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("re-export chain finds TSDoc on the original declaration", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo } from "./hop1.ts";\n`,
      "hop1.ts": `export { foo } from "./hop2.ts";\n`,
      "hop2.ts": `/**\n * Documented.\n */\nexport function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("chases import-then-export indirection (import {X}; export {X})", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo } from "./reexporter.ts";\n`,
      "reexporter.ts": `import { foo } from "./original.ts";\nexport { foo };\n`,
      "original.ts": `export function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.exportName).toBe("foo");
      expect(violations[0]?.declarationFile.endsWith("original.ts")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("import-then-export finds TSDoc on the original declaration", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo } from "./reexporter.ts";\n`,
      "reexporter.ts": `import { foo } from "./original.ts";\nexport { foo };\n`,
      "original.ts": `/**\n * Documented.\n */\nexport function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("aliased re-export chain resolves source name across hops", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo as bar } from "./hop1.ts";\n`,
      "hop1.ts": `export { foo } from "./hop2.ts";\n`,
      "hop2.ts": `export function foo(): void {}\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.exportName).toBe("bar");
      expect(violations[0]?.declarationFile.endsWith("hop2.ts")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("cycle detection: A re-exports from B which re-exports from A", () => {
    const root = makeWorkspace({
      "index.ts": `export { foo } from "./a.ts";\n`,
      "a.ts": `export { foo } from "./b.ts";\n`,
      "b.ts": `export { foo } from "./a.ts";\n`,
    });
    try {
      // Should not infinite-loop. Should silently skip (return no violations)
      // because the declaration is genuinely unresolved.
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("type-only re-export chain follows hops", () => {
    const root = makeWorkspace({
      "index.ts": `export type { Foo } from "./hop1.ts";\n`,
      "hop1.ts": `export type { Foo } from "./hop2.ts";\n`,
      "hop2.ts": `export type Foo = { x: number };\n`,
    });
    try {
      const violations = checkTsdocForModule(resolve(root, "index.ts"));
      expect(violations).toHaveLength(1);
      expect(violations[0]?.exportName).toBe("Foo");
      expect(violations[0]?.declarationFile.endsWith("hop2.ts")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
