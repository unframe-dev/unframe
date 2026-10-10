import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  cacheDir: "node_modules/.vite-editor",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:5175", changeOrigin: true },
      "/unity-preview": { target: "http://127.0.0.1:5175", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist-editor",
    emptyOutDir: true,
    rollupOptions: { input: { index: fileURLToPath(new URL("./editor.html", import.meta.url)) } },
  },
});
