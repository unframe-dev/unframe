import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { unityPreviewDevPlugin } from "./unity-preview-dev-plugin";

export function createViteConfig(command: "build" | "serve") {
  return {
    base: "/",
    plugins: [
      tailwindcss(),
      react(),
      ...(command === "build" ? [cloudflare()] : [unityPreviewDevPlugin()]),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
}

export default defineConfig(({ command }) => createViteConfig(command));
