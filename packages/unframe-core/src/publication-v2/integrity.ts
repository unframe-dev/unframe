import {
  assetSetManifestV2Schema,
  buildManifestV2Schema,
  presentationDefinitionV2Schema,
  publishedPresentationV2Schema,
  renderBundleV2Schema,
  type AssetDescriptorV2,
  type AssetSetManifestV2,
  type BuildManifestV2,
  type PresentationDefinitionV2,
  type PublishedPresentationV2,
  type RenderBundleV2,
} from "@unframe/contracts/presentation/v2";
import type { ZodType } from "zod";

import { hashCanonicalJsonPayload } from "../canonicalization/payload.js";
import type { Diagnostic, ValidationResult } from "../domain/model.js";
import { snapshotPlainJson } from "./plain-json.js";

export type BuildArtifactsV2 = {
  definition: PresentationDefinitionV2;
  renderBundle: RenderBundleV2;
  assetSet: AssetSetManifestV2;
  buildManifest: BuildManifestV2;
};

export type PublicationArtifactsV2 = BuildArtifactsV2 & {
  publishedPresentation: PublishedPresentationV2;
};

export type PublicationIntegrityInputV2 = {
  definition: unknown;
  renderBundle: unknown;
  assetSet: unknown;
  buildManifest: unknown;
  publishedPresentation: unknown;
};

export type BuildIntegrityInputV2 = Omit<PublicationIntegrityInputV2, "publishedPresentation">;

type ArtifactName = keyof PublicationIntegrityInputV2;
type Path = readonly (string | number)[];

const artifactNames = [
  "assetSet",
  "buildManifest",
  "definition",
  "publishedPresentation",
  "renderBundle",
] as const satisfies readonly ArtifactName[];

const diagnostic = (code: string, path: Path, message: string): Diagnostic => ({
  code,
  path,
  message,
});

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const pointer = (path: Path) =>
  path.map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/");
const sortedDiagnostics = (diagnostics: Diagnostic[]) =>
  diagnostics.sort((left, right) => {
    const artifact = compareText(String(left.path[0] ?? ""), String(right.path[0] ?? ""));
    if (artifact !== 0) return artifact;
    const path = compareText(pointer(left.path), pointer(right.path));
    return path !== 0 ? path : compareText(left.code, right.code);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const ownValue = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const parseArtifact = <T>(
  name: ArtifactName,
  schema: ZodType<T>,
  value: unknown,
  diagnostics: Diagnostic[],
): T | undefined => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues)
    diagnostics.push(
      diagnostic(
        "structure.invalid",
        [
          name,
          ...issue.path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment)),
        ],
        issue.message,
      ),
    );
  return undefined;
};

type AssetReference = {
  path: Path;
  descriptor?: AssetDescriptorV2;
  allowedMediaTypes: readonly AssetDescriptorV2["mediaType"][];
};

const fontMediaTypes = ["font/ttf", "font/otf"] as const;

const collectDefinitionAssetReferences = (
  definition: PresentationDefinitionV2,
  references: Map<string, AssetReference[]>,
) => {
  const add = (
    assetId: string,
    path: Path,
    allowedMediaTypes: readonly AssetDescriptorV2["mediaType"][],
  ) => {
    const entries = references.get(assetId) ?? [];
    entries.push({ path, allowedMediaTypes });
    references.set(assetId, entries);
  };

  for (const [nodeId, node] of Object.entries(definition.scene.nodes))
    if (node.kind === "model")
      add(node.assetId, ["definition", "scene", "nodes", nodeId, "assetId"], ["model/gltf-binary"]);

  for (const [surfaceId, surface] of Object.entries(definition.scene.surfaces)) {
    for (const [contentId, content] of Object.entries(surface.contentNodes)) {
      const base = [
        "definition",
        "scene",
        "surfaces",
        surfaceId,
        "contentNodes",
        contentId,
      ] as const;
      if (content.kind === "image")
        add(content.assetId, [...base, "assetId"], ["image/png", "image/jpeg"]);
      if (content.kind === "video") add(content.assetId, [...base, "assetId"], ["video/mp4"]);
      if (content.kind === "text") {
        add(content.style.fontAssetId, [...base, "style", "fontAssetId"], fontMediaTypes);
        for (const [index, assetId] of content.style.fallbackFontAssetIds.entries())
          add(assetId, [...base, "style", "fallbackFontAssetIds", index], fontMediaTypes);
      }
    }
    for (const [stateId, state] of Object.entries(surface.states))
      for (const [contentId, override] of Object.entries(state.contentOverrides))
        if (override.kind === "image" && override.assetId !== undefined)
          add(
            override.assetId,
            [
              "definition",
              "scene",
              "surfaces",
              surfaceId,
              "states",
              stateId,
              "contentOverrides",
              contentId,
              "assetId",
            ],
            ["image/png", "image/jpeg"],
          );
        else if (override.kind === "text" && override.style !== undefined) {
          add(
            override.style.fontAssetId,
            [
              "definition",
              "scene",
              "surfaces",
              surfaceId,
              "states",
              stateId,
              "contentOverrides",
              contentId,
              "style",
              "fontAssetId",
            ],
            fontMediaTypes,
          );
          for (const [index, assetId] of override.style.fallbackFontAssetIds.entries())
            add(
              assetId,
              [
                "definition",
                "scene",
                "surfaces",
                surfaceId,
                "states",
                stateId,
                "contentOverrides",
                contentId,
                "style",
                "fallbackFontAssetIds",
                index,
              ],
              fontMediaTypes,
            );
        }
  }
};

const collectBundleAssetReferences = (
  renderBundle: RenderBundleV2,
  references: Map<string, AssetReference[]>,
) => {
  const add = (
    assetId: string,
    path: Path,
    allowedMediaTypes: readonly AssetDescriptorV2["mediaType"][],
    descriptor?: AssetDescriptorV2,
  ) => {
    const entries = references.get(assetId) ?? [];
    entries.push(
      descriptor === undefined
        ? { path, allowedMediaTypes }
        : { path, descriptor, allowedMediaTypes },
    );
    references.set(assetId, entries);
  };

  for (const [surfaceId, surface] of Object.entries(renderBundle.surfaces))
    for (const [renderSurfaceId, renderSurface] of Object.entries(surface.renderSurfaces))
      for (const [artifactId, artifact] of Object.entries(renderSurface.artifacts)) {
        const base = [
          "renderBundle",
          "surfaces",
          surfaceId,
          "renderSurfaces",
          renderSurfaceId,
          "artifacts",
          artifactId,
        ] as const;
        if (artifact.kind === "baked-web")
          for (const [stateId, state] of Object.entries(artifact.states))
            add(
              state.texture.assetId,
              [...base, "states", stateId, "texture", "assetId"],
              ["image/png"],
              {
                checksum: state.texture.checksum,
                mediaType: state.texture.mediaType,
                encodedSizeBytes: state.texture.encodedSizeBytes,
              },
            );
        else if (artifact.kind === "video")
          add(artifact.assetId, [...base, "assetId"], ["video/mp4"], {
            checksum: artifact.checksum,
            mediaType: artifact.mediaType,
            encodedSizeBytes: artifact.encodedSizeBytes,
          });
        else
          for (const [nodeId, node] of Object.entries(artifact.nodes))
            if (node.kind === "text") {
              add(
                node.font.primary.assetId,
                [...base, "nodes", nodeId, "font", "primary", "assetId"],
                fontMediaTypes,
              );
              for (const [index, font] of node.font.fallbacks.entries())
                add(
                  font.assetId,
                  [...base, "nodes", nodeId, "font", "fallbacks", index, "assetId"],
                  fontMediaTypes,
                );
            }
      }

  for (const [modelId, model] of Object.entries(renderBundle.models))
    add(model.assetId, ["renderBundle", "models", modelId, "assetId"], ["model/gltf-binary"], {
      checksum: model.checksum,
      mediaType: model.mediaType,
      encodedSizeBytes: model.encodedSizeBytes,
    });
};

const descriptorEquals = (left: AssetDescriptorV2, right: AssetDescriptorV2) =>
  left.checksum === right.checksum &&
  left.mediaType === right.mediaType &&
  left.encodedSizeBytes === right.encodedSizeBytes;

const verifyAssetClosure = (
  definition: PresentationDefinitionV2,
  renderBundle: RenderBundleV2,
  assetSet: AssetSetManifestV2,
  diagnostics: Diagnostic[],
) => {
  const references = new Map<string, AssetReference[]>();
  collectDefinitionAssetReferences(definition, references);
  collectBundleAssetReferences(renderBundle, references);

  for (const [assetId, assetReferences] of references) {
    const descriptor = ownValue(assetSet.assets, assetId);
    if (descriptor === undefined) {
      for (const reference of assetReferences)
        diagnostics.push(
          diagnostic("reference.invalid", reference.path, `Referenced Asset ${assetId} is absent.`),
        );
      continue;
    }
    for (const reference of assetReferences)
      if (reference.descriptor !== undefined && !descriptorEquals(reference.descriptor, descriptor))
        diagnostics.push(
          diagnostic(
            "artifact.invalid",
            reference.path,
            `Embedded descriptor for Asset ${assetId} does not match AssetSetManifest.`,
          ),
        );
      else if (!reference.allowedMediaTypes.includes(descriptor.mediaType))
        diagnostics.push(
          diagnostic(
            "artifact.invalid",
            reference.path,
            `Asset ${assetId} has incompatible media type ${descriptor.mediaType}.`,
          ),
        );
  }

  for (const assetId of Object.keys(assetSet.assets))
    if (!references.has(assetId))
      diagnostics.push(
        diagnostic(
          "reference.invalid",
          ["assetSet", "assets", assetId],
          `Asset ${assetId} is not referenced by Definition or RenderBundle.`,
        ),
      );
};

const verifyModelReferences = (
  definition: PresentationDefinitionV2,
  renderBundle: RenderBundleV2,
  diagnostics: Diagnostic[],
) => {
  for (const [modelId, model] of Object.entries(renderBundle.models))
    if (model.assetId !== modelId)
      diagnostics.push(
        diagnostic(
          "artifact.invalid",
          ["renderBundle", "models", modelId, "assetId"],
          "Compiled model key and assetId must agree.",
        ),
      );

  const modelNodes = new Map(
    Object.entries(definition.scene.nodes).filter((entry) => entry[1].kind === "model"),
  );
  for (const [nodeId, node] of modelNodes) {
    if (node.kind !== "model") continue;
    const model = ownValue(renderBundle.models, node.assetId);
    if (model === undefined)
      diagnostics.push(
        diagnostic(
          "reference.invalid",
          ["definition", "scene", "nodes", nodeId, "assetId"],
          `Model Asset ${node.assetId} has no compiled model entry.`,
        ),
      );
  }

  const verifyModelNode = (nodeId: string, path: Path) => {
    const node = ownValue(definition.scene.nodes, nodeId);
    if (node === undefined || node.kind !== "model") {
      diagnostics.push(
        diagnostic(
          "reference.invalid",
          [...path, "nodeId"],
          `Model Node ${nodeId} does not exist.`,
        ),
      );
      return undefined;
    }
    return node;
  };
  const verifyClip = (nodeId: string, clipId: string, path: Path) => {
    const node = verifyModelNode(nodeId, path);
    if (node === undefined) return;
    const model = ownValue(renderBundle.models, node.assetId);
    if (model !== undefined && ownValue(model.clips, clipId) === undefined)
      diagnostics.push(
        diagnostic(
          "reference.invalid",
          [...path, "clipId"],
          `Clip ${clipId} is absent from compiled Model ${node.assetId}.`,
        ),
      );
  };

  for (const [groupId, group] of Object.entries(definition.flow.groups))
    for (const [stepId, step] of Object.entries(group.steps))
      for (const [cueIndex, cue] of step.cues.entries()) {
        const cuePath = [
          "definition",
          "flow",
          "groups",
          groupId,
          "steps",
          stepId,
          "cues",
          cueIndex,
        ] as const;
        if (cue.trigger.kind === "modelClipCompleted")
          verifyClip(cue.trigger.nodeId, cue.trigger.clipId, [...cuePath, "trigger"]);
        for (const [actionIndex, action] of cue.actions.entries()) {
          const actionPath = [...cuePath, "actions", actionIndex] as const;
          if (action.kind === "modelClip.play")
            verifyClip(action.nodeId, action.clipId, actionPath);
          else if (
            action.kind === "modelClip.pause" ||
            action.kind === "modelClip.resume" ||
            action.kind === "modelClip.stop"
          )
            verifyModelNode(action.nodeId, actionPath);
        }
      }
};

const verifyHashes = (artifacts: BuildArtifactsV2, diagnostics: Diagnostic[]) => {
  const definitionHash = hashCanonicalJsonPayload(artifacts.definition);
  const renderBundleHash = hashCanonicalJsonPayload(artifacts.renderBundle);
  const assetSetHash = hashCanonicalJsonPayload(artifacts.assetSet);
  const expectedHashes = { definitionHash, renderBundleHash, assetSetHash } as const;

  if (artifacts.renderBundle.definitionHash !== definitionHash)
    diagnostics.push(
      diagnostic(
        "hash.invalid",
        ["renderBundle", "definitionHash"],
        "RenderBundle definitionHash does not match PresentationDefinition.",
      ),
    );
  for (const [field, expected] of Object.entries(expectedHashes))
    if (artifacts.buildManifest[field as keyof typeof expectedHashes] !== expected)
      diagnostics.push(
        diagnostic(
          "hash.invalid",
          ["buildManifest", field],
          `${field} does not match its canonical artifact hash.`,
        ),
      );
};

const verifyBuildIdentity = (artifacts: BuildArtifactsV2, diagnostics: Diagnostic[]) => {
  if (artifacts.definition.presentationId !== artifacts.buildManifest.presentationId)
    diagnostics.push(
      diagnostic(
        "artifact.invalid",
        ["buildManifest", "presentationId"],
        "BuildManifest presentationId must equal PresentationDefinition presentationId.",
      ),
    );
};

const verifyPublication = (artifacts: PublicationArtifactsV2, diagnostics: Diagnostic[]) => {
  const sharedFields = [
    "schemaVersion",
    "buildId",
    "presentationId",
    "sourceDraftRevision",
    "definitionHash",
    "renderBundleHash",
    "assetSetHash",
    "contractVersions",
  ] as const;
  for (const field of sharedFields) {
    const buildValue = artifacts.buildManifest[field];
    const publishedValue = artifacts.publishedPresentation[field];
    const equal =
      typeof buildValue === "object"
        ? hashCanonicalJsonPayload(buildValue) === hashCanonicalJsonPayload(publishedValue)
        : buildValue === publishedValue;
    if (!equal)
      diagnostics.push(
        diagnostic(
          "publication.invalid",
          ["publishedPresentation", field],
          `${field} must equal BuildManifest.`,
        ),
      );
  }

  const { publicationManifestHash: _excluded, ...publicationPayload } =
    artifacts.publishedPresentation;
  const expectedPublicationHash = hashCanonicalJsonPayload(publicationPayload);
  if (artifacts.publishedPresentation.publicationManifestHash !== expectedPublicationHash)
    diagnostics.push(
      diagnostic(
        "publication.invalid",
        ["publishedPresentation", "publicationManifestHash"],
        "publicationManifestHash must hash every other PublishedPresentation field.",
      ),
    );
};

const verifyUnparsedPublicationAgreement = (
  buildManifest: BuildManifestV2,
  publishedPresentation: unknown,
  diagnostics: Diagnostic[],
) => {
  if (!isRecord(publishedPresentation)) return;
  const sharedFields = [
    "schemaVersion",
    "buildId",
    "presentationId",
    "sourceDraftRevision",
    "definitionHash",
    "renderBundleHash",
    "assetSetHash",
    "contractVersions",
  ] as const;
  for (const field of sharedFields) {
    const publishedValue = publishedPresentation[field];
    const buildValue = buildManifest[field];
    const equal =
      publishedValue !== undefined && typeof buildValue === "object"
        ? hashCanonicalJsonPayload(buildValue) === hashCanonicalJsonPayload(publishedValue)
        : buildValue === publishedValue;
    if (!equal)
      diagnostics.push(
        diagnostic(
          "publication.invalid",
          ["publishedPresentation", field],
          `${field} must equal BuildManifest.`,
        ),
      );
  }
};

function verifyIntegrity(
  input: unknown,
  publication: true,
): ValidationResult<PublicationArtifactsV2>;
function verifyIntegrity(input: unknown, publication: false): ValidationResult<BuildArtifactsV2>;
function verifyIntegrity(
  input: unknown,
  publication: boolean,
): ValidationResult<BuildArtifactsV2 | PublicationArtifactsV2> {
  const snapshot = snapshotPlainJson(input);
  if (!snapshot.valid)
    return {
      valid: false,
      diagnostics: [
        diagnostic("canonical.invalid", snapshot.failure.path, snapshot.failure.message),
      ],
    };
  if (!isRecord(snapshot.value))
    return {
      valid: false,
      diagnostics: [diagnostic("structure.invalid", [], "The input envelope must be an object.")],
    };

  const diagnostics: Diagnostic[] = [];
  const names = publication
    ? artifactNames
    : artifactNames.filter((name) => name !== "publishedPresentation");
  const expectedNames = new Set<string>(names);
  for (const key of Object.keys(snapshot.value))
    if (!expectedNames.has(key))
      diagnostics.push(diagnostic("structure.invalid", [key], `Unknown artifact ${key}.`));
  for (const name of names)
    if (!(name in snapshot.value))
      diagnostics.push(diagnostic("structure.invalid", [name], `Artifact ${name} is required.`));

  const definition = parseArtifact(
    "definition",
    presentationDefinitionV2Schema,
    snapshot.value.definition,
    diagnostics,
  );
  const renderBundle = parseArtifact(
    "renderBundle",
    renderBundleV2Schema,
    snapshot.value.renderBundle,
    diagnostics,
  );
  const assetSet = parseArtifact(
    "assetSet",
    assetSetManifestV2Schema,
    snapshot.value.assetSet,
    diagnostics,
  );
  const buildManifest = parseArtifact(
    "buildManifest",
    buildManifestV2Schema,
    snapshot.value.buildManifest,
    diagnostics,
  );
  const publishedPresentation = publication
    ? parseArtifact(
        "publishedPresentation",
        publishedPresentationV2Schema,
        snapshot.value.publishedPresentation,
        diagnostics,
      )
    : undefined;
  if (
    definition === undefined ||
    renderBundle === undefined ||
    assetSet === undefined ||
    buildManifest === undefined ||
    (publication && publishedPresentation === undefined)
  ) {
    if (publication && buildManifest !== undefined && publishedPresentation === undefined)
      verifyUnparsedPublicationAgreement(
        buildManifest,
        snapshot.value.publishedPresentation,
        diagnostics,
      );
    return { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
  }

  const artifacts = {
    definition,
    renderBundle,
    assetSet,
    buildManifest,
    ...(publishedPresentation === undefined ? {} : { publishedPresentation }),
  };
  verifyAssetClosure(definition, renderBundle, assetSet, diagnostics);
  verifyModelReferences(definition, renderBundle, diagnostics);
  verifyHashes(artifacts, diagnostics);
  verifyBuildIdentity(artifacts, diagnostics);
  if (publishedPresentation !== undefined)
    verifyPublication({ ...artifacts, publishedPresentation }, diagnostics);
  return diagnostics.length === 0
    ? { valid: true, value: artifacts, diagnostics: [] }
    : { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
}

export const verifyBuildIntegrityV2 = (input: unknown): ValidationResult<BuildArtifactsV2> =>
  verifyIntegrity(input, false);

export const verifyPublicationIntegrityV2 = (
  input: PublicationIntegrityInputV2,
): ValidationResult<PublicationArtifactsV2> => verifyIntegrity(input, true);
