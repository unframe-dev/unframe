import { expect, it } from "vitest";
import { isComponentStructure } from "../src/index.js";

it("accepts Video content with a fixed Asset reference and loop", () => {
  expect(
    isComponentStructure({
      id: "structure",
      componentId: "component",
      partBindings: {},
      variantStyles: {},
      timelines: [],
      baseSemanticTree: { rootNodeIds: [], nodes: {} },
      root: {
        kind: "frame",
        id: "root",
        layout: { kind: "absolute", x: 0, y: 0, width: 100, height: 100 },
        children: [
          {
            kind: "video",
            id: "video",
            asset: { kind: "asset-ref", assetId: "movie" },
            loop: false,
            layout: { kind: "absolute", x: 0, y: 0, width: 100, height: 100 },
            style: {
              fit: "stretch",
              tint: { red: 1, green: 1, blue: 1, alpha: 1 },
              border: { width: 0, radius: 0, color: { red: 0, green: 0, blue: 0, alpha: 0 } },
            },
          },
        ],
      },
    }),
  ).toBe(true);
});

import {
  video,
  Video,
  Frame,
  defineComponentStructure,
  playModelClip,
  pauseModelClip,
  resumeModelClip,
  stopModelClip,
  playMedia,
  pauseMedia,
  seekMedia,
  modelClipCompleted,
} from "../src/index.js";

it("supports factory and JSX Video declarations", () => {
  const value = {
    id: "video",
    asset: { kind: "asset-ref" as const, assetId: "movie" },
    loop: false,
    layout: { kind: "absolute" as const, x: 0, y: 0, width: 100, height: 100 },
    style: {
      fit: "stretch" as const,
      tint: { red: 1, green: 1, blue: 1, alpha: 1 },
      border: { width: 0, radius: 0, color: { red: 0, green: 0, blue: 0, alpha: 0 } },
    },
  };
  const structure = defineComponentStructure({
    id: "structure",
    componentId: "component",
    partBindings: {},
    variantStyles: {},
    timelines: [],
    baseSemanticTree: { rootNodeIds: [], nodes: {} },
    root: Frame({
      id: "root",
      layout: { kind: "absolute", x: 0, y: 0, width: 100, height: 100 },
      children: Video(value),
    }),
  });
  expect(structure.root.kind === "frame" ? structure.root.children[0] : undefined).toEqual(
    video(value),
  );
  expect(() => video({ ...value, loop: "yes" } as never)).toThrow();
});

it("validates playback builder fields at the declaration boundary", () => {
  const value = {
    nodeId: "root",
    clipId: "clip-0",
    speed: 1,
    loop: false,
    completion: "blocking" as const,
    transition: { kind: "immediate" as const },
    conflict: "reject" as const,
  };
  expect(playModelClip(value)).toMatchObject({ kind: "playModelClip", clipId: "clip-0" });
  expect(() => playModelClip({ ...value, speed: 0 })).toThrow();
  expect(pauseModelClip({ nodeId: "root" })).toEqual({ kind: "pauseModelClip", nodeId: "root" });
  expect(resumeModelClip({ nodeId: "root" })).toEqual({ kind: "resumeModelClip", nodeId: "root" });
  expect(stopModelClip({ nodeId: "root" })).toEqual({ kind: "stopModelClip", nodeId: "root" });
  expect(playMedia({ surfaceId: "surface" })).toEqual({ kind: "playMedia", surfaceId: "surface" });
  expect(pauseMedia({ surfaceId: "surface" })).toEqual({
    kind: "pauseMedia",
    surfaceId: "surface",
  });
  expect(
    seekMedia({ surfaceId: "surface", positionSeconds: { kind: "literal", value: 1 } }),
  ).toMatchObject({ kind: "seekMedia" });
  expect(modelClipCompleted({ nodeId: "root", clipId: "clip-0" })).toEqual({
    kind: "modelClipCompleted",
    nodeId: "root",
    clipId: "clip-0",
  });
});
