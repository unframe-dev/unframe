import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = fileURLToPath(new URL("../", import.meta.url));
const vendor = join(root, "vendor/apriltag");
const output = join(root, "public/external/detectors");
const provenance = z
  .object({ files: z.array(z.object({ name: z.string(), sha256: z.string() })) })
  .parse(JSON.parse(await readFile(join(vendor, "provenance.json"), "utf8")));
await mkdir(output, { recursive: true });
for (const file of provenance.files) {
  const contents = await readFile(join(vendor, file.name));
  if (createHash("sha256").update(contents).digest("hex") !== file.sha256) {
    throw new Error(`AprilTag vendor hash mismatch: ${file.name}`);
  }
  await copyFile(join(vendor, file.name), join(output, file.name));
}
await copyFile(join(vendor, "provenance.json"), join(output, "provenance.json"));
// The upstream UMD module needs an ESM export when loaded by a module Worker.
await writeFile(
  join(output, "apriltag.mjs"),
  `${await readFile(join(vendor, "apriltag_wasm.js"), "utf8")}\nexport default AprilTagWasm;\n`,
);
const require = createRequire(import.meta.url);
const arucoRoot = dirname(require.resolve("js-aruco2/package.json"));
await copyFile(join(arucoRoot, "LICENSE.txt"), join(output, "LICENSE.posit"));
await copyFile(
  join(arucoRoot, "src/dictionaries/apriltag_36h11.js"),
  join(output, "apriltag_36h11.js"),
);

// The package exposes UMD globals via `this`, which is not an ESM named export.
const moduleSource = async (name: string): Promise<string> => {
  let text = await readFile(join(arucoRoot, `src/${name}.js`), "utf8");
  text = text.replace(/require\(['"]\.\/?svd['"]\)\.SVD/g, "deps.SVD");
  if (/require\s*\(/.test(text)) throw new Error(`Unexpected CommonJS dependency in ${name}`);
  return text;
};
const generated = [
  `// Generated from js-aruco2@2.0.0. Preserve the upstream notices below.`,
  `const SVD = (function(deps){${await moduleSource("svd")}\nreturn this.SVD;}).call({}, {});`,
  `const POS = (function(deps){${await moduleSource("posit1")}\nreturn this.POS;}).call({}, {SVD});`,
  `export { POS };`,
].join("\n");
await writeFile(join(root, "src/fiducials/generated-posit.mjs"), generated);

console.log("Prepared AprilTag 3 WASM and POSIT pose assets.");
