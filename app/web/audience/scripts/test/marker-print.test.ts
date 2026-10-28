// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = pathToFileURL(`${process.cwd()}/`);
function blackBounds(source: string) {
  const rectangles = [
    ...source.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"\/>/g),
  ].map((match) => match.slice(1).map(Number));
  return {
    left: Math.min(...rectangles.map(([x]) => x!)),
    top: Math.min(...rectangles.map(([, y]) => y!)),
    right: Math.max(...rectangles.map(([x, , width]) => x! + width!)),
    bottom: Math.max(...rectangles.map(([, y, , height]) => y! + height!)),
  };
}

beforeAll(() =>
  execFileSync(process.execPath, [new URL("scripts/generate-marker-board.mjs", root).pathname]),
);
describe("AprilTag print profiles", () => {
  it("uses the bundled board identity and a single tag36h11 ID 0", () => {
    const config = JSON.parse(
      readFileSync(new URL("src/fiducials/default-board.json", root), "utf8"),
    );
    const definitions = JSON.parse(
      readFileSync(new URL("public/markers/definitions.json", root), "utf8"),
    );
    expect(definitions.boardId).toBe(config.boardId);
    expect(definitions.revision).toBe(config.revision);
    expect(definitions.families.tag36h11).toHaveLength(1);
    expect(definitions.families.tag36h11[0].id).toBe(config.markers[0].id);
    expect(config.markers[0].sizeMeters).toBe(0.15);
  });
  it.each([22.5, 36, 50, 60, 70])(
    "preserves exact %s cm outer size and black-boundary ratio",
    (size) => {
      const source = readFileSync(new URL(`public/markers/april-single-${size}.svg`, root), "utf8");
      expect(source).toContain(
        `width="${size * 10}mm" height="${size * 10}mm" viewBox="0 0 150 150"`,
      );
      expect(blackBounds(source)).toEqual({ left: 25, top: 25, right: 125, bottom: 125 });
    },
  );
});
