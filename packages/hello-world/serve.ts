import indexHtml from "./index.html";

const PORT = Number(Bun.env["FURNACE_PORT"] ?? 8765);
const server = Bun.serve({
  port: PORT,
  routes: { "/": indexHtml },
});

console.log(`PORT=${server.port}`);
console.log(`Serving at ${server.url}`);
