import { defineConfig } from "vite-plus";
import { threeAlias } from "./vite-shared.mjs";

export default defineConfig({ resolve: { alias: [threeAlias] } });
