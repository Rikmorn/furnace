import { startServer } from "./server.ts";

const DEFAULT_PORT = 4500;

function parsePort(argv: string[]): number {
  const i = argv.indexOf("--port");
  if (i === -1) return DEFAULT_PORT;
  const value = Number(argv[i + 1]);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    console.error(`furnace-editor: invalid --port "${argv[i + 1]}"`);
    process.exit(1);
  }
  return value;
}

const root = process.cwd();
try {
  const server = await startServer({
    root,
    port: parsePort(process.argv.slice(2)),
  });
  console.log(`furnace editor daemon serving ${root}`);
  console.log(`  http://127.0.0.1:${server.port}/`);
} catch (err) {
  console.error(
    `furnace-editor: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
