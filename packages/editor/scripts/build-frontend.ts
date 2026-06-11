// Internal build tooling — Bun APIs allowed (does not ship; output dist/frontend does).
import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["src/frontend/index.html"],
  outdir: "dist/frontend",
  minify: true,
  sourcemap: "linked",
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`build-frontend: ${result.outputs.length} files → dist/frontend`);
