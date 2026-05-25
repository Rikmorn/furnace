const cookbookRoot = `${import.meta.dir}/..`;

const demoEntries = await Array.fromAsync(
  new Bun.Glob("src/demos/*/index.html").scan({
    cwd: cookbookRoot,
    absolute: true,
  }),
);

const isDev = Bun.argv.includes("--dev");

const result = await Bun.build({
  entrypoints: [`${cookbookRoot}/src/index.html`, ...demoEntries],
  outdir: `${cookbookRoot}/../../dist/cookbook${isDev ? "/dev" : ""}`,
  minify: !isDev,
  sourcemap: isDev ? "inline" : "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`[furnace/cookbook] built ${result.outputs.length} file(s)`);
