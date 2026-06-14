import indexHtml from "./src/index.html";

const PORT = Number(Bun.env["FURNACE_PORT"] ?? 8766);
const server = Bun.serve({ port: PORT, routes: { "/": indexHtml } });
console.log(`PORT=${server.port}`);
console.log(`Serving at ${server.url}`);
