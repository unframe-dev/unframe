import type { BuildArtifactsV2, CueInput, CueState } from "@unframe/unframe-core";

export type PreviewVector2 = [number, number];
export type PreviewVector3 = [number, number, number];
export type PreviewQuaternion = [number, number, number, number];
export type PreviewUvRect = [number, number, number, number];

export type PreviewNode = {
  id: string;
  parentId: string | null;
  position: PreviewVector3;
  rotation: PreviewQuaternion;
  scale: PreviewVector3;
};

export type PreviewTexture = { id: string; url: string };
export type PreviewQuad = {
  id: string;
  nodeId: string;
  textureId: string;
  position: PreviewVector3;
  size: PreviewVector2;
  uvRect: PreviewUvRect;
  layer: number;
};

export type PreviewSceneLoad = {
  readonly nodes: readonly PreviewNode[];
  readonly textures: readonly PreviewTexture[];
  readonly quads: readonly PreviewQuad[];
  readonly stageSize: PreviewVector3;
};

export type PreviewFrame = {
  generation: number;
  nodes: {
    id: string;
    position: PreviewVector3;
    rotation: PreviewQuaternion;
    scale: PreviewVector3;
  }[];
  quads: {
    id: string;
    visible: boolean;
    opacity: number;
    blendTextureId?: string;
    blendWeight?: number;
  }[];
};

export type PreviewDocument = {
  artifacts: BuildArtifactsV2;
  scene: PreviewSceneLoad;
  dispose(): void;
};

export type PreviewState = CueState;
export type PreviewAction = { id: string; label: string; input: CueInput };
