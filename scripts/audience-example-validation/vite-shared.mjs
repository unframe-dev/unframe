import { fileURLToPath } from "node:url";

export const threeAlias = {
  find: /^three$/,
  replacement: fileURLToPath(
    new URL("../../app/web/audience/node_modules/three/build/three.module.js", import.meta.url),
  ),
};
