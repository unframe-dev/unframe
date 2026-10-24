import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  appType: "mpa",
  plugins: [react()],
  server: { host: "127.0.0.1" },
  build: {
    rolldownOptions: {
      input: { index: "index.html" },
      output: {
        codeSplitting: { groups: [{ name: "vendor", test: /node_modules/, maxSize: 400_000 }] },
      },
    },
  },
});
