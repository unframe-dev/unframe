import { cp, mkdir, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const source = fileURLToPath(
  new URL("../../../.unframe/unity-preview/UnframePreview/", import.meta.url),
);
const target = fileURLToPath(new URL("./player/", import.meta.url));
for (const suffix of ["loader.js", "framework.js", "wasm", "data"])
  await access(join(source, "Build", `UnframePreview.${suffix}`));
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
