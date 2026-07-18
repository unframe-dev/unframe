import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: "/editor/",
  plugins: [react(), ...(mode === "e2e" ? [] : [cloudflare()])],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
}));
