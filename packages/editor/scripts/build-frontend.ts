// Internal build tooling — Bun APIs allowed (does not ship; output dist/frontend does).
import tailwind from "bun-plugin-tailwind";

// Build production-mode React so the shipped editor bundle drops the dev-only warnings +
// the "Download the React DevTools" console log. Two levers are needed: setting NODE_ENV
// on the build process picks react-dom's `production` package export (which file is
// bundled), and `define` inlines the same value for any residual runtime `process.env`
// checks. Bun.build sets neither by default, so react-dom otherwise ships in dev mode.
process.env.NODE_ENV = "production";

const result = await Bun.build({
  entrypoints: [
    "src/frontend/index.html",
    // The generation worker ships as its own module bundle: the chrome spawns it
    // by URL (new Worker("/generation-worker.js", {type:"module"})), so it cannot
    // ride the html entry's graph.
    "src/frontend/generation-worker.ts",
  ],
  outdir: "dist/frontend",
  minify: true,
  sourcemap: "linked",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`build-frontend: ${result.outputs.length} files → dist/frontend`);
