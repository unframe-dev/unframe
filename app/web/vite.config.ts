import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export function createViteConfig(command: "build" | "serve") {
  return {
    base: "/editor/",
    plugins: [react(), ...(command === "build" ? [cloudflare()] : [])],
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
}

export default defineConfig(({ command }) => createViteConfig(command));
