import { expect, it } from "vite-plus/test";
import { stylePackageRoots } from "../src/style-package-roots.js";

it("keeps the direct Tailwind compiler root when its PostCSS plugin is configured", () => {
  const files = Object.entries({
    "postcss.config.mjs": 'export default {plugins:{"@tailwindcss/postcss":{}}};',
    "input.css": "main { color: red; }",
  }).map(([path, source]) => ({ path, bytes: Buffer.from(source).toString("base64") }));
  expect(stylePackageRoots(files)).toEqual(
    expect.arrayContaining(["postcss", "@tailwindcss/postcss", "tailwindcss"]),
  );
});

it("captures style config and CSS dependencies without presentation or test tools", () => {
  const files = Object.entries({
    "postcss.config.mjs": 'import {plugins} from "./config/plugins"; export default {plugins};',
    "config/plugins.ts":
      'import fs from "node:fs"; const data=JSON.parse(fs.readFileSync("config/plugins.json","utf8")); export const plugins={"@tailwindcss/postcss":{}};',
    "config/plugins.json": '{"plugin":"json-plugin"}',
    "style.css": '@import "tailwindcss"; @plugin "@tailwindcss/forms"; @config "./theme.ts";',
    "theme.ts": 'import theme from "theme-package"; export default theme;',
    "opening.component.tsx": 'import {defineComponent} from "@unframe-dev/authoring";',
    "test/example.test.mjs":
      'import ts from "typescript"; import {resolvePresentation} from "@unframe-dev/compiler";',
  }).map(([path, source]) => ({ path, bytes: Buffer.from(source).toString("base64") }));
  const roots = stylePackageRoots(files);
  expect(roots).toEqual(
    expect.arrayContaining([
      "postcss",
      "tailwindcss",
      "@tailwindcss/postcss",
      "@tailwindcss/forms",
      "theme-package",
      "json-plugin",
    ]),
  );
  expect(roots).not.toContain("typescript");
  expect(roots).not.toContain("@unframe-dev/compiler");
  expect(roots).not.toContain("@unframe-dev/authoring");
});
