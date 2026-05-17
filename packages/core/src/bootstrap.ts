import { main } from "./entry.ts";

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  document.body.innerText = `Error: ${msg}`;
});
