import { createRoot } from "react-dom/client";
import { App } from "./components/App.tsx";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("editor chrome: #root missing from index.html");
createRoot(rootEl).render(<App />);
