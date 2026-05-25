import type { HTMLBundle } from "bun";
import indexHtml from "./src/index.html";

const htmls = await Array.fromAsync(
  new Bun.Glob("./src/demos/*/index.html").scan({
    cwd: import.meta.dir,
    absolute: true,
  }),
);

const routes: Record<string, HTMLBundle> = { "/": indexHtml };
for (const path of htmls) {
  const slug = path.split("/").at(-2);
  if (!slug) continue;
  // Boundary cast: Bun's *.html ambient module declares default export as HTMLBundle; TS cannot carry that through dynamic import(string).
  const mod: { default: HTMLBundle } = await import(path);
  routes[`/${slug}`] = mod.default;
}

const server = Bun.serve({
  port: Number(Bun.env["FURNACE_PORT"] ?? 8766),
  routes,
});
const demoCount = Object.keys(routes).length - 1;
console.log(`PORT=${server.port}`);
console.log(`Serving ${demoCount} demo(s) at ${server.url}`);
