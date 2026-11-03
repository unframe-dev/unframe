import { hashCanonicalJsonPayload } from "@unframe-dev/artifacts";
import type { ContentHash } from "./dependency-graph.js";
import type { ProjectConfig } from "./load-config.js";

export type ComponentOrigin =
  | {
      kind: "local";
      entryFile: string;
      files: { path: string; hash: ContentHash }[];
      sourceHash: ContentHash;
    }
  | { kind: "package"; packageKey: ContentHash; subpath: string };
export type ComponentLock = {
  componentId: string;
  version: number;
  origin: ComponentOrigin;
  manifestHash: ContentHash;
} & (
  | { mode: "structured"; structureHash: ContentHash }
  | { mode: "opaque"; rendererInputHash: ContentHash }
);
export type LockedSourceAsset = {
  id: string;
  path: string;
  mediaType: ProjectConfig["assets"][string]["mediaType"];
  hash: ContentHash;
  size: number;
  transformIdentity?: ContentHash;
};
export const hashLocalSource = (
  entryFile: string,
  files: readonly { path: string; hash: ContentHash }[],
): ContentHash => hashCanonicalJsonPayload({ entryFile, files }) as ContentHash;
