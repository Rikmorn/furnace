import indexHtml from "./index.html";

const server = Bun.serve({
  port: 0,
  routes: {
    "/": indexHtml,
  },
});

console.log(`PORT=${server.port}`);
console.log(`Serving at ${server.url}`);
