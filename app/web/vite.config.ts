import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export function createViteConfig(command: "build" | "serve") {
  return {
    base: "/",
    build: {
      emptyOutDir: true,
      outDir: "dist",
    },
    plugins: [tailwindcss(), react(), ...(command === "build" ? [cloudflare()] : [])],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
}

export default defineConfig(({ command }) => createViteConfig(command));
