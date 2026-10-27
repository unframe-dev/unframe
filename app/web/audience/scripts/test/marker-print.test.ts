// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = pathToFileURL(`${process.cwd()}/`);
function page(query: string) {
  const pageDocument = document.implementation.createHTMLDocument();
  pageDocument.documentElement.innerHTML = readFileSync(
    new URL("public/print-target.html", root),
    "utf8",
  );
  const script = pageDocument.querySelector("script")?.textContent ?? "";
  runInNewContext(script, { document: pageDocument, location: { search: query }, URLSearchParams });
  return { document: pageDocument };
}
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
  it("defaults to AprilTag ID 0 with a 15 cm black boundary", () => {
    const document = page("").document;
    expect(document.querySelector("#board")?.getAttribute("src")).toBe(
      "/markers/april-single-22.5.svg",
    );
    expect(document.querySelector("#back")?.getAttribute("href")).toBe("/?size=22.5");
    expect(document.querySelector("#instructions")?.textContent).toContain("15.00");
    expect(document.querySelector("#instructions")?.textContent).toContain("100%");
    expect(document.querySelector("#detector")).toBeNull();
    expect(document.querySelector("#mode")).toBeNull();
  });
  it.each([22.5, 50, 60, 70])(
    "preserves exact %s cm outer size and black-boundary ratio",
    (size) => {
      const source = readFileSync(new URL(`public/markers/april-single-${size}.svg`, root), "utf8");
      expect(source).toContain(
        `width="${size * 10}mm" height="${size * 10}mm" viewBox="0 0 150 150"`,
      );
      expect(blackBounds(source)).toEqual({ left: 25, top: 25, right: 125, bottom: 125 });
      const document = page(`?size=${size}`).document;
      expect(document.querySelector("#board")?.getAttribute("src")).toBe(
        `/markers/april-single-${size}.svg`,
      );
      expect(document.querySelector<HTMLImageElement>("#board")?.style.width).toBe(
        `${size * 10}mm`,
      );
      expect(document.querySelector("#back")?.getAttribute("href")).toBe(`/?size=${size}`);
      expect(document.querySelector<HTMLSelectElement>("#size")?.value).toBe(String(size));
    },
  );
  it.each(["?size=10", "?size=", "?size=50&size=22.5"])(
    "rejects conflicting dimensions %s",
    (query) => {
      expect(page(query).document.querySelector<HTMLImageElement>("#board")?.hidden).toBe(true);
    },
  );
});
