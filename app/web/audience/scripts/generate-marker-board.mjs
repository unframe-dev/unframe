import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { AR } = require("js-aruco2");
require("js-aruco2/src/dictionaries/apriltag_36h11.js");
const config = JSON.parse(
  await readFile(new URL("../public/poc-config.json", import.meta.url), "utf8"),
);
if (config.markers.length !== 1 || config.markers[0].id !== 0)
  throw new Error("Print assets require a single registered marker ID 0.");
const out = fileURLToPath(new URL("../public/markers/", import.meta.url));
await mkdir(out, { recursive: true });
const dictionary = new AR.Dictionary("APRILTAG_36h11");
const bits = dictionary.codeList[0];
const count = Math.sqrt(dictionary.nBits) + 2;
const rows = Array.from({ length: count }, (_, y) =>
  Array.from({ length: count }, (_, x) =>
    x === 0 || y === 0 || x === count - 1 || y === count - 1
      ? "0"
      : bits[(y - 1) * (count - 2) + x - 1],
  ).join(""),
);
let cells = "";
for (let row = 0; row < count; row++)
  for (let col = 0; col < count; col++)
    if (rows[row][col] === "0")
      cells += `<rect x="${25 + (col * 100) / count}" y="${25 + (row * 100) / count}" width="${100 / count}" height="${100 / count}"/>`;
for (const outerCm of [22.5, 36, 50, 60, 70]) {
  const outerMm = outerCm * 10;
  await writeFile(
    `${out}/april-single-${outerCm}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outerMm}mm" height="${outerMm}mm" viewBox="0 0 150 150"><title>tag36h11 ID 0 outer size ${outerMm}mm; black boundary ${(outerMm * 2) / 3}mm; white quiet zone ${outerMm / 6}mm</title><rect width="150" height="150" fill="white"/><g fill="black" shape-rendering="crispEdges">${cells}</g></svg>\n`,
  );
}
await writeFile(
  `${out}/definitions.json`,
  JSON.stringify(
    {
      boardId: config.boardId,
      revision: config.revision,
      cellRegion: "black border; outer white quiet zone excluded",
      families: { tag36h11: [{ id: 0, rows }] },
    },
    null,
    2,
  ) + "\n",
);
console.log("Generated AprilTag ID 0 assets with 22.5/36/50/60/70 cm outer sizes.");
