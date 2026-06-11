import { createRoot } from "react-dom/client";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("editor chrome: #root missing from index.html");
createRoot(rootEl).render(<p className="p-4">furnace editor — chrome boots in Task 6</p>);
