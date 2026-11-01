import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts", cli: "src/process/main.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [
        /^@unframe\/(?!build(?:$|\/)|local-editor|render-browser|media-node|styles-node|worker-host|workspace-node)/,
      ],
      neverBundle: [
        "@unframe/build",
        "@unframe/local-editor",
        "@unframe/render-browser",
        "@unframe/media-node",
        "@unframe/styles-node",
        "@unframe/worker-host",
        "@unframe/workspace-node",
      ],
      onlyBundle: false,
    },
    format: "esm",
    platform: "node",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
