import indexHtml from "./index.html";

// Fixed port for predictable bookmarking. Side effect: dev:web and dev:native
// can't run concurrently (both bind 8765 — the second fails). If that becomes
// an issue, swap to `port: Number(process.env.FURNACE_PORT ?? "8765")` and have
// the native crate pass FURNACE_PORT=0 to its spawned child.
const PORT = 8765;

const server = Bun.serve({
  port: PORT,
  routes: {
    "/": indexHtml,
  },
});

console.log(`PORT=${server.port}`);
console.log(`Serving at ${server.url}`);
