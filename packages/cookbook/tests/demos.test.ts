import { expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";

const DEMOS_DIR = `${import.meta.dir}/../src/demos`;

function listDemoSlugs(): string[] {
  if (!existsSync(DEMOS_DIR)) return [];
  return readdirSync(DEMOS_DIR).filter((name) => {
    const p = `${DEMOS_DIR}/${name}`;
    return statSync(p).isDirectory();
  });
}

test("every src/demos/<slug>/ folder has the required three files", () => {
  const slugs = listDemoSlugs();
  for (const slug of slugs) {
    const dir = `${DEMOS_DIR}/${slug}`;
    expect(existsSync(`${dir}/index.html`)).toBe(true);
    expect(existsSync(`${dir}/entry.ts`)).toBe(true);
    expect(existsSync(`${dir}/help.ts`)).toBe(true);
  }
});

test("demo slugs are kebab-case (lowercase letters, digits, hyphens)", () => {
  const slugs = listDemoSlugs();
  for (const slug of slugs) {
    expect(slug).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  }
});
