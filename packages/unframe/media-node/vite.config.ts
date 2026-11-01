import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [/^@unframe\/(?!worker-host$)/],
      neverBundle: ["@unframe/worker-host", "react"],
      onlyBundle: false,
    },
    format: "esm",
    platform: "node",
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
