import { join } from "node:path";
import indexHtml from "./src/index.html";

const PORT = Number(Bun.env["FURNACE_PORT"] ?? 8766);
const REGIONS_DIR = join(import.meta.dir, "regions");
const WORLDS_DIR = join(import.meta.dir, "worlds");
const CATALOG_DIR = join(import.meta.dir, "catalog");

const server = Bun.serve({
  port: PORT,
  routes: { "/": indexHtml },
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/regions/")) {
      const filename = url.pathname.slice("/regions/".length);
      if (!filename || filename.includes("..")) {
        return new Response("Not found", { status: 404 });
      }
      const file = Bun.file(join(REGIONS_DIR, filename));
      if (!(await file.exists())) {
        return new Response("Not found", { status: 404 });
      }
      const contentType = filename.endsWith(".scene.json")
        ? "application/json"
        : "application/octet-stream";
      return new Response(file, { headers: { "Content-Type": contentType } });
    }
    if (url.pathname.startsWith("/worlds/")) {
      const filename = url.pathname.slice("/worlds/".length);
      if (!filename || filename.includes("..")) {
        return new Response("Not found", { status: 404 });
      }
      const file = Bun.file(join(WORLDS_DIR, filename));
      if (!(await file.exists())) {
        return new Response("Not found", { status: 404 });
      }
      const contentType = filename.endsWith(".scene.json")
        ? "application/json"
        : "application/octet-stream";
      return new Response(file, { headers: { "Content-Type": contentType } });
    }
    // The entity catalog (F3b): `entities.json` + the archetype `.fmesh` meshes the field-world
    // placement loader fetches. Global (outside /worlds/*) — one catalog is shared across worlds.
    // Mirrors the /worlds/* octet-stream route; entities.json is `.json` (not `.scene.json`).
    if (url.pathname.startsWith("/catalog/")) {
      const filename = url.pathname.slice("/catalog/".length);
      if (!filename || filename.includes("..")) {
        return new Response("Not found", { status: 404 });
      }
      const file = Bun.file(join(CATALOG_DIR, filename));
      if (!(await file.exists())) {
        return new Response("Not found", { status: 404 });
      }
      const contentType = filename.endsWith(".json")
        ? "application/json"
        : "application/octet-stream";
      return new Response(file, { headers: { "Content-Type": contentType } });
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`PORT=${server.port}`);
console.log(`Serving at ${server.url}`);
