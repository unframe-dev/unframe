import { expect, it } from "vite-plus/test";
import { retainPreviewCanvas } from "../viewport-canvas";

it("reattaches the same Unity canvas after a view is remounted", () => {
  const workspace = {};
  const first = {} as HTMLCanvasElement;
  expect(retainPreviewCanvas(workspace, () => first)).toBe(first);
  expect(retainPreviewCanvas(workspace, () => ({}) as HTMLCanvasElement)).toBe(first);
});
it("keeps different Host workspaces on separate canvases", () => {
  const first = retainPreviewCanvas({}, () => ({}) as HTMLCanvasElement);
  const second = retainPreviewCanvas({}, () => ({}) as HTMLCanvasElement);
  expect(second).not.toBe(first);
});
