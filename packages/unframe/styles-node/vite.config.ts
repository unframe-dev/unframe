import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts", compiler: "src/compiler.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [/^@unframe-dev\/(?!worker-host$|build$)/],
      neverBundle: ["@unframe-dev/worker-host", "@unframe-dev/build", "jsonc-parser", "react"],
      onlyBundle: false,
    },
    format: "esm",
    platform: "node",
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
