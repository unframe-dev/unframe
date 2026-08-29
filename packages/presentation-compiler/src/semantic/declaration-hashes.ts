import type {
  ComponentManifest,
  ComponentStructure,
  FrameDeclaration,
  Json,
  OpaqueSurfaceSemanticAdapter,
  SemanticNodeDeclaration,
  SurfaceDeclaration,
  SurfaceStateDeclaration,
  ThemeDeclaration,
} from "@unframe/presentation";
import { hashCanonicalJsonPayload } from "@unframe/presentation-core";

type JsonRecord = Readonly<Record<string, Json>>;

const withoutSource = <T extends JsonRecord>(value: T): Omit<T, "source"> => {
  const { source: _source, ...semantic } = value;
  return semantic;
};

const semanticNode = (value: SemanticNodeDeclaration) => withoutSource(value);

const surfaceState = (value: SurfaceStateDeclaration) => ({
  ...withoutSource(value),
  semanticOverrides: value.semanticOverrides.map((override) => withoutSource(override)),
});

const opaqueSurface = (value: OpaqueSurfaceSemanticAdapter): JsonRecord => ({
  ...withoutSource(value),
  baseSemanticTree: {
    ...value.baseSemanticTree,
    nodes: Object.fromEntries(
      Object.entries(value.baseSemanticTree.nodes).map(([id, node]) => [id, semanticNode(node)]),
    ),
  },
  states: Object.fromEntries(
    Object.entries(value.states).map(([id, state]) => [id, surfaceState(state)]),
  ),
});

const structureRoot = (value: SurfaceDeclaration | FrameDeclaration): JsonRecord => {
  const semantic = withoutSource(value);
  if (value.kind === "surface")
    return {
      ...semantic,
      root: structureRoot(value.root),
      baseSemanticTree: {
        ...value.baseSemanticTree,
        nodes: Object.fromEntries(
          Object.entries(value.baseSemanticTree.nodes).map(([id, node]) => [
            id,
            semanticNode(node),
          ]),
        ),
      },
      states: Object.fromEntries(
        Object.entries(value.states).map(([id, state]) => [id, surfaceState(state)]),
      ),
    };
  return {
    ...semantic,
    children: value.children.map((child) =>
      child.kind === "frame" ? structureRoot(child) : withoutSource(child),
    ),
  };
};

/** Hashes a Theme declaration while retaining arbitrary token and named-style JSON verbatim. */
export const hashThemeDeclaration = (declaration: ThemeDeclaration): string =>
  hashCanonicalJsonPayload(withoutSource(declaration));

/** Hashes a Component Manifest after excluding only declaration source metadata. */
export const hashComponentManifestDeclaration = (declaration: ComponentManifest): string => {
  if (declaration.authoring.mode !== "opaque")
    return hashCanonicalJsonPayload(withoutSource(declaration));
  const opaque = declaration as Extract<ComponentManifest, { authoring: { mode: "opaque" } }>;
  return hashCanonicalJsonPayload({
    ...withoutSource(opaque),
    semantics: {
      ...opaque.semantics,
      surfaces: opaque.semantics.surfaces.map(opaqueSurface),
    },
  });
};

/** Hashes a Component Structure after excluding source metadata from declaration nodes. */
export const hashComponentStructureDeclaration = (declaration: ComponentStructure): string =>
  hashCanonicalJsonPayload({
    ...withoutSource(declaration),
    root: structureRoot(declaration.root),
    timelines: declaration.timelines.map((timeline) => withoutSource(timeline)),
  });
