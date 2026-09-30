import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist-author",
    rollupOptions: { input: { index: fileURLToPath(new URL("./author.html", import.meta.url)) } },
  },
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
