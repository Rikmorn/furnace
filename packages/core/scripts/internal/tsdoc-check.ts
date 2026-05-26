import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

export type TsdocViolation = {
  exportName: string;
  declarationFile: string;
  line: number;
};

type ReExport = {
  /** The name exported from the module (alias if `as` used). */
  exportedName: string;
  /** The name in the source file (original identifier). */
  sourceName: string;
  /** Absolute path to the source file. `null` for local declarations in this file. */
  sourceFile: string | null;
};

/**
 * Scans a module's `index.ts` for public re-exports and returns one
 * violation per exported name whose declaration lacks a leading TSDoc
 * block. Skips identifiers starting with `_`.
 */
export function checkTsdocForModule(indexPath: string): TsdocViolation[] {
  const indexSource = readFileSync(indexPath, "utf8");
  const indexFile = ts.createSourceFile(
    indexPath,
    indexSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const reExports = collectReExports(indexFile, dirname(indexPath));
  const violations: TsdocViolation[] = [];
  for (const re of reExports) {
    if (re.exportedName.startsWith("_")) continue;
    const declFile = re.sourceFile ?? indexPath;
    const hit = locateDeclaration(declFile, re.sourceName, new Set());
    if (hit === null) continue; // unresolved — out of scope
    if (hit.hasTsdoc) continue;
    violations.push({
      exportName: re.exportedName,
      declarationFile: hit.filePath,
      line: hit.line,
    });
  }
  return violations;
}

function collectReExports(file: ts.SourceFile, baseDir: string): ReExport[] {
  const out: ReExport[] = [];
  for (const stmt of file.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.exportClause) {
      const sourceFile = stmt.moduleSpecifier
        ? resolveModulePath(stmt.moduleSpecifier, baseDir)
        : null;
      if (ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const exportedName = el.name.text;
          const sourceName = el.propertyName?.text ?? el.name.text;
          out.push({ exportedName, sourceName, sourceFile });
        }
      }
      continue;
    }
    // Inline `export function foo`, `export const Foo`, etc. (no re-export).
    if (isExportedDeclaration(stmt)) {
      const names = getDeclarationNames(stmt);
      for (const name of names) {
        out.push({ exportedName: name, sourceName: name, sourceFile: null });
      }
    }
  }
  return out;
}

function resolveModulePath(
  spec: ts.Expression,
  baseDir: string,
): string | null {
  if (!ts.isStringLiteral(spec)) return null;
  const rel = spec.text;
  if (rel.startsWith(".") && !rel.endsWith(".ts")) {
    // Bun/TS allows `./foo` resolving to `./foo.ts` or `./foo/index.ts`.
    // Mirror that for our scan.
    const direct = resolve(baseDir, `${rel}.ts`);
    if (safeExists(direct)) return direct;
    const indexed = resolve(baseDir, rel, "index.ts");
    if (safeExists(indexed)) return indexed;
    return null;
  }
  return resolve(baseDir, rel);
}

function safeExists(path: string): boolean {
  try {
    readFileSync(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

function isExportedDeclaration(stmt: ts.Statement): boolean {
  const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function getDeclarationNames(stmt: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(stmt) && stmt.name) return [stmt.name.text];
  if (ts.isClassDeclaration(stmt) && stmt.name) return [stmt.name.text];
  if (ts.isInterfaceDeclaration(stmt)) return [stmt.name.text];
  if (ts.isTypeAliasDeclaration(stmt)) return [stmt.name.text];
  if (ts.isVariableStatement(stmt)) {
    const names: string[] = [];
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
    }
    return names;
  }
  if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
    return [stmt.name.text];
  }
  return [];
}

type DeclarationHit = { filePath: string; line: number; hasTsdoc: boolean };

function locateDeclaration(
  filePath: string,
  name: string,
  visited: Set<string>,
): DeclarationHit | null {
  if (visited.has(filePath)) return null;
  visited.add(filePath);
  const sf = parseSourceFile(filePath);
  if (sf === null) return null;
  const local = findLocalDeclaration(sf, filePath, name);
  if (local !== null) return local;
  return followIndirection(sf, filePath, name, visited);
}

function parseSourceFile(filePath: string): ts.SourceFile | null {
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
}

function findLocalDeclaration(
  sf: ts.SourceFile,
  filePath: string,
  name: string,
): DeclarationHit | null {
  for (const stmt of sf.statements) {
    if (!isExportedDeclaration(stmt)) continue;
    const names = getDeclarationNames(stmt);
    if (!names.includes(name)) continue;
    const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart(sf));
    const hasTsdoc = hasLeadingTsdoc(stmt, sf);
    return { filePath, line: line + 1, hasTsdoc };
  }
  return null;
}

function followIndirection(
  sf: ts.SourceFile,
  filePath: string,
  name: string,
  visited: Set<string>,
): DeclarationHit | null {
  const baseDir = dirname(filePath);
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (!stmt.exportClause) continue;
    if (!ts.isNamedExports(stmt.exportClause)) continue;
    const match = stmt.exportClause.elements.find(
      (el) => el.name.text === name,
    );
    if (!match) continue;
    const sourceName = match.propertyName?.text ?? match.name.text;
    if (stmt.moduleSpecifier) {
      const next = resolveModulePath(stmt.moduleSpecifier, baseDir);
      if (next === null) return null;
      return locateDeclaration(next, sourceName, visited);
    }
    const binding = findImportBinding(sf, sourceName, baseDir);
    if (binding === null) return null;
    return locateDeclaration(binding.sourceFile, binding.sourceName, visited);
  }
  return null;
}

type ImportBinding = { sourceName: string; sourceFile: string };

function findImportBinding(
  sf: ts.SourceFile,
  localName: string,
  baseDir: string,
): ImportBinding | null {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const clause = stmt.importClause;
    if (!clause?.namedBindings) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    for (const el of clause.namedBindings.elements) {
      if (el.name.text !== localName) continue;
      const sourceName = el.propertyName?.text ?? el.name.text;
      const sourceFile = resolveModulePath(stmt.moduleSpecifier, baseDir);
      if (sourceFile === null) continue;
      return { sourceName, sourceFile };
    }
  }
  return null;
}

function hasLeadingTsdoc(node: ts.Node, sf: ts.SourceFile): boolean {
  const fullText = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!ranges) return false;
  for (const r of ranges) {
    if (r.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const text = fullText.slice(r.pos, r.end);
    if (text.startsWith("/**") && !text.startsWith("/***")) return true;
  }
  return false;
}
