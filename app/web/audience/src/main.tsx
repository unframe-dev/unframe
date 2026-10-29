import { createRoot } from "react-dom/client";
import { AudienceTheme } from "./ui/theme";
import { App } from "./App";
const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");
createRoot(root).render(
  <AudienceTheme>
    <App />
  </AudienceTheme>,
);
