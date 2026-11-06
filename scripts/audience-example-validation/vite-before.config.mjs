import { execFileSync } from "node:child_process";
import { defineConfig } from "vite-plus";
import { threeAlias } from "./vite-shared.mjs";

const before = execFileSync(
  "git",
  ["show", "c445c4ed106fbfb88b8d5ef70f7ac3f1c8e465a8:app/web/audience/src/rendering/png-plan.ts"],
  {
    encoding: "utf8",
  },
);
export default defineConfig({
  resolve: { alias: [threeAlias] },
  plugins: [
    {
      name: "baseline-png-plan",
      enforce: "pre",
      transform(_code, id) {
        if (id.endsWith("/app/web/audience/src/rendering/png-plan.ts"))
          return { code: before, map: null };
      },
    },
  ],
});
