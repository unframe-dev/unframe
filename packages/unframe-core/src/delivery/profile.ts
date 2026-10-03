import type {
  PresentationDefinition,
  RenderBundle,
  ProjectionProfileDescriptorWire,
  ProjectedRuntimeCatalogWire,
} from "@unframe/contracts/presentation";
import { calculateProjectionProfileId } from "./profile-identity.js";
import { selectDeliveryArtifacts, type DeliverySelection } from "./selection.js";
import { parseDeliveryInputs } from "./input.js";
import type { DeliverySourceInput } from "./input.js";

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const pairs = <T>(record: Record<string, T>) =>
  Object.entries(record).sort(([a], [b]) => byId(a, b));
const vec2 = (value: readonly [number, number]) => ({ x: value[0], y: value[1] });
const vec3 = (value: readonly [number, number, number]) => ({
  x: value[0],
  y: value[1],
  z: value[2],
});
const quat = (value: readonly [number, number, number, number]) => ({
  x: value[0],
  y: value[1],
  z: value[2],
  w: value[3],
});
const owner = (value: { kind: "presentation" } | { kind: "group"; groupId: string }) =>
  value.kind === "presentation" ? { presentation: {} } : { group: { groupId: value.groupId } };
const roleNumber = { presenter: 1, viewer: 2 } as const;
const semanticRoles = {
  heading: 1,
  paragraph: 2,
  image: 3,
  button: 4,
  list: 5,
  listItem: 6,
  table: 7,
  row: 8,
  cell: 9,
  columnHeader: 10,
  rowHeader: 11,
} as const;
const nativeFeature = { clip: 1, ellipsis: 2, explicitFontFallback: 3 } as const;
const bakedFeature = { png: 1, srgb: 2, "alpha-opaque": 3, "alpha-straight": 4 } as const;
const videoFeature = { h264: 1, vp9: 2, av1: 3, alpha: 4, audio: 5 } as const;
const easing = { linear: 1, cubicIn: 2, cubicOut: 3, cubicInOut: 4 } as const;
const scalarType = { string: 1, number: 2, boolean: 3, null: 4 } as const;
const fit = { contain: 1, cover: 2, stretch: 3 } as const;
const toUInt64 = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("uint64 must be a safe non-negative integer.");
  return String(value);
};
const bounds = (value: { x: number; y: number; width: number; height: number }) => ({
  x: value.x,
  y: value.y,
  width: value.width,
  height: value.height,
});
const numericFeatures = <T extends string>(features: T[], mapping: Record<T, number>) =>
  [...new Set(features.map((feature) => mapping[feature]))].sort((a, b) => a - b);

const artifactWire = (
  artifact: NonNullable<DeliverySelection["renderSurfaces"][number]["states"][number]["artifact"]>,
  selectedStateIds: Set<string>,
) => {
  if (artifact.kind === "baked-web")
    return {
      bakedWeb: {
        artifactId: artifact.id,
        contractVersion: artifact.contractVersion,
        requiredFeatures: numericFeatures(artifact.requiredFeatures, bakedFeature),
        states: pairs(artifact.states)
          .filter(([stateId]) => selectedStateIds.has(stateId))
          .map(([stateId, state]) => ({
            stateId,
            texture: {
              assetId: state.texture.assetId,
              checksum: state.texture.checksum,
              encodedSizeBytes: toUInt64(state.texture.encodedSizeBytes),
              pixelSize: {
                width: toUInt64(state.texture.pixelSize[0]),
                height: toUInt64(state.texture.pixelSize[1]),
              },
              alphaMode: state.texture.alphaMode === "opaque" ? 1 : 2,
              mipCount: state.texture.mipCount,
              decodedGpuBytes: toUInt64(state.texture.gpuBytes),
            },
          })),
      },
    };
  if (artifact.kind === "video")
    return {
      video: {
        artifactId: artifact.id,
        contractVersion: artifact.contractVersion,
        requiredFeatures: numericFeatures(artifact.requiredFeatures, videoFeature),
        videoAssetId: artifact.assetId,
        checksum: artifact.checksum,
        pixelSize: {
          width: toUInt64(artifact.pixelSize[0]),
          height: toUInt64(artifact.pixelSize[1]),
        },
        durationMs: toUInt64(artifact.durationMilliseconds),
        loop: artifact.loop,
        hasAudio: artifact.audio,
        encodedSizeBytes: toUInt64(artifact.encodedSizeBytes),
        codec: artifact.codec === "h264" ? 1 : artifact.codec === "vp9" ? 2 : 3,
        hasAlpha: artifact.alpha,
      },
    };
  const font = (face: { assetId: string; supportedCodePointRanges: [number, number][] }) => ({
    assetId: face.assetId,
    supportedCodePointRanges: face.supportedCodePointRanges.map(([first, last]) => ({
      first,
      last,
    })),
  });
  const textValue = (value: (typeof artifact.nodes)[string] & { kind: "text" }) => {
    const source = value.value;
    if (source.kind === "literal") return { literal: { value: source.value } };
    if (source.kind === "variableString")
      return {
        stringVariable: {
          variableId: source.variableId,
          allowedCodePointRanges: source.format.allowedCodePointRanges.map(([first, last]) => ({
            first,
            last,
          })),
        },
      };
    if (source.kind === "variableBoolean")
      return {
        booleanVariable: {
          variableId: source.variableId,
          trueLabel: source.format.trueLabel,
          falseLabel: source.format.falseLabel,
        },
      };
    if (source.kind === "variableNumber")
      return {
        numberVariable: {
          variableId: source.variableId,
          fractionDigits: source.format.fractionDigits,
        },
      };
    return {
      stepTimer: {
        groupId: source.groupId,
        stepId: source.stepId,
        cueId: source.cueId,
        durationMs: toUInt64(source.durationMilliseconds),
        whenStepInactive: source.whenStepInactive === "empty" ? 1 : 2,
        format: source.format === "mm:ss" ? 1 : 2,
      },
    };
  };
  return {
    nativeUi: {
      artifactId: artifact.id,
      contractVersion: artifact.contractVersion,
      requiredFeatures: numericFeatures(artifact.requiredFeatures, nativeFeature),
      rootNodeId: artifact.rootNodeId,
      nodes: pairs(artifact.nodes).map(([, node]) =>
        node.kind === "group"
          ? {
              group: {
                nodeId: node.id,
                bounds: bounds(node.bounds),
                clip: node.clip,
                childNodeIds: node.children,
              },
            }
          : {
              text: {
                nodeId: node.id,
                bounds: bounds(node.bounds),
                semanticNodeId: node.semanticNodeId,
                value: textValue(node),
                font: {
                  primary: font(node.font.primary),
                  fallbacks: node.font.fallbacks.map(font),
                },
                color: node.color,
                fontSize: node.fontSize,
                lineHeight: node.lineHeight,
                align: node.align === "start" ? 1 : node.align === "center" ? 2 : 3,
                overflow: node.overflow === "clip" ? 1 : 2,
                maxCodePoints: toUInt64(node.maxCodePoints),
              },
            },
      ),
    },
  };
};

const semanticTree = (
  tree: RenderBundle["surfaces"][string]["semanticsByState"][string],
  role: "presenter" | "viewer",
) => ({
  rootNodeIds: tree.rootNodeIds,
  nodes: pairs(tree.nodes).map(([, node]) => {
    const base: Record<string, unknown> = {
      semanticNodeId: node.id,
      order: node.order,
      role: semanticRoles[node.role],
      interactionEnabled: node.role === "button" && role === "presenter" && node.stateEnabled,
    };
    if (node.parentId !== null) base["parentNodeId"] = node.parentId;
    if ("text" in node) base["text"] = node.text;
    if ("language" in node && node.language !== undefined) base["language"] = node.language;
    if ("alt" in node) base["alt"] = node.alt;
    if ("label" in node && node.label !== undefined) base["label"] = node.label;
    if (node.role === "heading") base["headingLevel"] = node.level;
    if (node.role === "list") base["ordered"] = node.ordered;
    if (node.role === "button" && base["interactionEnabled"])
      base["interactionId"] = node.interactionId;
    return base;
  }),
});

const runtimeCatalog = (
  definition: PresentationDefinition,
  bundle: RenderBundle,
  selection: DeliverySelection,
) => {
  const visibleNodes = new Set(selection.visibleNodeIds);
  const visibleSurfaces = new Set(selection.visibleSurfaceIds);
  const visibleVariables = new Set(selection.visibleVariableIds);
  const nodes = selection.visibleNodeIds.map((id) => {
    const node = definition.scene.nodes[id]!;
    const parent =
      node.parent.kind === "stage"
        ? { stage: {} }
        : node.parent.kind === "node"
          ? { node: { nodeId: node.parent.nodeId } }
          : {
              presenterAnchor: {
                target: { head: 1, leftHand: 2, rightHand: 3, body: 4 }[node.parent.target],
                followPosition: node.parent.followPosition,
                followRotation: node.parent.followRotation,
              },
            };
    const kind: Record<string, unknown> =
      node.kind === "container"
        ? { container: {} }
        : node.kind === "surface"
          ? { surface: { semanticSurfaceId: node.surfaceId } }
          : node.kind === "model"
            ? { model: { modelAssetId: node.assetId } }
            : node.kind === "shape"
              ? {
                  shape: {
                    [node.geometry.kind]:
                      node.geometry.kind === "box"
                        ? { size: vec3(node.geometry.size) }
                        : { radius: node.geometry.radius },
                    material: {
                      color: node.material.color,
                      doubleSided: node.material.doubleSided,
                      castsShadows: node.material.castsShadows,
                      receivesShadows: node.material.receivesShadows,
                    },
                  },
                }
              : {
                  light: {
                    [node.light.kind]:
                      node.light.kind === "directional"
                        ? {
                            color: node.light.color,
                            intensityLux: node.light.intensityLux,
                            castsShadows: node.light.castsShadows,
                          }
                        : node.light.kind === "point"
                          ? {
                              color: node.light.color,
                              intensityCandela: node.light.intensityCandela,
                              rangeMeters: node.light.rangeMeters,
                              castsShadows: node.light.castsShadows,
                            }
                          : {
                              color: node.light.color,
                              intensityCandela: node.light.intensityCandela,
                              rangeMeters: node.light.rangeMeters,
                              outerAngleDegrees: node.light.outerAngleDegrees,
                              innerAngleDegrees: node.light.innerAngleDegrees,
                              castsShadows: node.light.castsShadows,
                            },
                  },
                };
    return { nodeId: id, parent, order: node.order, owner: owner(node.owner), ...kind };
  });
  const surfaces = selection.visibleSurfaceIds.map((id) => {
    const surface = definition.scene.surfaces[id]!;
    const hasVideo = selection.renderSurfaces.some(
      (render) => render.semanticSurfaceId === id && render.rendererKind === "video",
    );
    return {
      surfaceId: id,
      hostNodeId: surface.hostNodeId,
      reachableStateIds: Object.keys(surface.states).sort(byId),
      hasVideo,
      physicalSizeMeters: vec2(surface.physicalSizeMeters),
      logicalSize: vec2(surface.logicalSize),
      fit: fit[surface.fit],
      owner: owner(definition.scene.nodes[surface.hostNodeId]!.owner),
    };
  });
  const variables = selection.visibleVariableIds.map((id) => {
    const variable = definition.flow.variables[id]!;
    return { variableId: id, type: scalarType[variable.type], owner: owner(variable.owner) };
  });
  const timelines = pairs(definition.flow.timelines)
    .filter(([, timeline]) =>
      timeline.tracks.every((track) => visibleNodes.has(track.target.nodeId)),
    )
    .map(([id, timeline]) => ({
      timelineId: id,
      durationMs: toUInt64(timeline.durationMilliseconds),
      owner: owner(timeline.owner),
      tracks: timeline.tracks.map((track) => ({
        target: {
          nodeId: track.target.nodeId,
          property: {
            opacity: 1,
            "transform.position": 2,
            "transform.rotation": 3,
            "transform.scale": 4,
          }[track.target.property],
        },
        keyframes: track.keyframes.map((frame) => {
          const value =
            typeof frame.value === "number"
              ? { number: { value: frame.value } }
              : frame.value.length === 3
                ? { vector3: { value: vec3(frame.value) } }
                : { quaternion: { value: quat(frame.value) } };
          return {
            timeMs: toUInt64(frame.timeMilliseconds),
            ...value,
            ...(frame.easingToNext ? { easingToNext: easing[frame.easingToNext] } : {}),
          };
        }),
      })),
    }));
  const modelClips = selection.visibleNodeIds.flatMap((id) => {
    const node = definition.scene.nodes[id];
    if (node?.kind !== "model") return [];
    const model = bundle.models[node.assetId];
    if (!model) throw new Error(`Model Asset ${node.assetId} is absent.`);
    return pairs(model.clips).map(([clipId, clip]) => ({
      modelNodeId: id,
      modelAssetId: node.assetId,
      clipId,
      sourceAnimationIndex: clip.sourceAnimationIndex,
      durationMs: toUInt64(clip.durationMilliseconds),
      owner: owner(node.owner),
    }));
  });
  if (
    variables.some((variable) => !visibleVariables.has(variable.variableId)) ||
    surfaces.some((surface) => !visibleSurfaces.has(surface.surfaceId))
  )
    throw new Error("Invalid runtime catalog closure.");
  return { catalogContractVersion: 2, nodes, surfaces, variables, timelines, modelClips };
};

export const buildProjectionProfile = (
  input: DeliverySourceInput,
  role: "presenter" | "viewer",
) => {
  if (role !== "presenter" && role !== "viewer")
    throw new TypeError("Delivery role must be presenter or viewer.");
  const parsed = parseDeliveryInputs(input);
  const definition = parsed.definition;
  const bundle = parsed.renderBundle;
  const publication = parsed.publishedPresentation;
  const capability = parsed.capability;
  const selection = selectDeliveryArtifacts(input, role);
  const renderSurfaces = [...selection.renderSurfaces]
    .sort((a, b) => byId(a.semanticSurfaceId, b.semanticSurfaceId) || a.layer - b.layer)
    .map((render) => {
      const source =
        bundle.surfaces[render.semanticSurfaceId]!.renderSurfaces[render.renderSurfaceId]!;
      const artifacts = [
        ...new Map(
          render.states.flatMap((state) =>
            state.artifact ? [[state.artifact.id, state.artifact] as const] : [],
          ),
        ).values(),
      ]
        .sort((a, b) => byId(a.id, b.id))
        .map((artifact) =>
          artifactWire(
            artifact,
            new Set(
              render.states
                .filter((state) => state.artifact?.id === artifact.id)
                .map((state) => state.stateId),
            ),
          ),
        );
      return {
        renderSurfaceId: render.renderSurfaceId,
        semanticSurfaceId: render.semanticSurfaceId,
        logicalBounds: bounds(source.logicalBounds),
        layer: render.layer,
        rendererKind:
          render.rendererKind === "baked-web"
            ? 1
            : render.rendererKind === "native-ui"
              ? 2
              : render.rendererKind === "video"
                ? 3
                : 0,
        artifactContractVersion:
          render.states.find((state) => state.artifact)?.artifact?.contractVersion ?? 0,
        stateBindings: render.states.map((state) => ({
          stateId: state.stateId,
          ...(state.artifact ? { artifact: { artifactId: state.artifact.id } } : { empty: {} }),
        })),
        artifacts,
      };
    });
  const semanticSurfaces = selection.visibleSurfaceIds.map((id) => {
    const compiled = bundle.surfaces[id]!;
    return {
      semanticSurfaceId: id,
      renderSurfaceIds: compiled.renderSurfaceIds,
      states: pairs(compiled.semanticsByState).map(([stateId, tree]) => {
        const enabled = new Set(
          Object.values(tree.nodes)
            .filter((node) => node.role === "button" && node.stateEnabled && role === "presenter")
            .map((node) => (node.role === "button" ? node.interactionId : "")),
        );
        return {
          stateId,
          semanticTree: semanticTree(tree, role),
          interactiveRegions: (compiled.interactionsByState[stateId] ?? [])
            .filter((region) => enabled.has(region.interactionId))
            .map((region) => ({
              interactionId: region.interactionId,
              semanticNodeId: region.semanticNodeId,
              normalizedBounds: bounds(region.bounds),
              priority: region.priority,
            })),
        };
      }),
    };
  });
  const catalog = runtimeCatalog(definition, bundle, selection);
  const capabilities = [1];
  if (catalog.timelines.length) capabilities.push(2);
  if (semanticSurfaces.some((surface) => surface.states.length > 1)) capabilities.push(3);
  if (catalog.surfaces.some((surface) => surface.hasVideo)) capabilities.push(4);
  if (catalog.modelClips.length) capabilities.push(5);
  if (catalog.nodes.some((node) => "presenterAnchor" in node.parent)) capabilities.push(6);
  const profile: ProjectionProfileDescriptorWire = {
    projectionProfileId: "",
    key: {
      publication: {
        presentationId: publication.presentationId,
        publicationEpoch: toUInt64(publication.publicationEpoch),
        publicationManifestHash: publication.publicationManifestHash,
      },
      projectionContractVersion: 1,
      role: roleNumber[role],
      capabilityProfileId: capability.capabilityProfileId,
    },
    visibleNodeIds: selection.visibleNodeIds,
    visibleSurfaceIds: selection.visibleSurfaceIds,
    visibleVariableIds: selection.visibleVariableIds,
    renderSurfaces,
    semanticSurfaces,
    localOverlays: [],
    requiredRuntimeCapabilities: capabilities,
    runtimeCatalog: catalog as unknown as ProjectedRuntimeCatalogWire,
  };
  profile.projectionProfileId = calculateProjectionProfileId(profile);
  return {
    profile: JSON.parse(JSON.stringify(profile)) as ProjectionProfileDescriptorWire,
    selection,
  };
};
