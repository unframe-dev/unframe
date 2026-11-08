import { reactResourceId } from "@unframe-dev/compiler";
import type { CompilerSourceAssetBytes } from "../build-execution/api/types.js";
import { checkParsedAuthoringProject, parseAuthoringProject } from "@unframe-dev/source";
import type { LockedOpaqueBundleInput } from "./index.js";
import { assembleParsedAuthoringProject } from "./api/authoring-project-pipeline.js";
import { prepareParsedLockedOpaqueBundleInput } from "./semantic/prepare-locked-opaque-bundle-input.js";

export type OpaqueRenderProgram = {
  readonly entryId: string;
  readonly moduleHash: string;
  readonly javascript: string;
  readonly stylesheets: readonly string[];
  readonly assets: readonly {
    readonly path: string;
    readonly mediaType: string;
    readonly dataBase64: string;
  }[];
  readonly props: Readonly<Record<string, string | number | boolean>>;
  readonly stateKeysById?: Readonly<Record<string, string>>;
  readonly debugSourceMap?: string;
  readonly debugSourcePaths?: readonly string[];
  readonly debugLocalSourceFiles?: Readonly<Record<string, string>>;
  readonly entryOrigins?: readonly {
    readonly startLine: number;
    readonly endLine: number;
    readonly firstLinePrefix: number;
    readonly origin: {
      readonly fileName: string;
      readonly start: number;
      readonly end: number;
      readonly line: number;
      readonly column: number;
    };
  }[];
};
export type OpaqueBundlePort = {
  bundle(input: LockedOpaqueBundleInput): Promise<
    | {
        readonly ok: true;
        readonly javascript: string;
        readonly sourceMap: string;
        readonly assets: readonly {
          readonly fileName: string;
          readonly source: string | Uint8Array;
        }[];
        readonly stylesheets: readonly string[];
      }
    | {
        readonly ok: false;
        readonly diagnostics: readonly {
          readonly code: string;
          readonly message: string;
          readonly path: readonly string[];
        }[];
      }
  >;
  mediaTypeFor(path: string): string;
};

export class OpaquePreparationFailure extends Error {
  constructor(
    readonly diagnostics: readonly {
      readonly code: string;
      readonly message: string;
      readonly path: readonly (string | number)[];
    }[],
  ) {
    super("Opaque renderer preparation failed.");
    this.name = "OpaquePreparationFailure";
  }
}

export const prepareOpaquePrograms = async (
  source: unknown,
  carrier: unknown,
  sourceAssetBytes: CompilerSourceAssetBytes,
  ports: OpaqueBundlePort,
): Promise<readonly OpaqueRenderProgram[]> => {
  const parsed = parseAuthoringProject(source);
  if (!parsed.ok)
    throw new OpaquePreparationFailure(
      parsed.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        path: [item.fileName],
      })),
    );
  const checkedSource = checkParsedAuthoringProject(parsed.value);
  if (!checkedSource.valid)
    throw new OpaquePreparationFailure(
      checkedSource.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        path: [item.fileName],
      })),
    );
  const assembled = assembleParsedAuthoringProject(
    parsed.value,
    checkedSource.value,
    carrier,
    sourceAssetBytes,
  );
  if (!assembled.valid)
    throw new OpaquePreparationFailure(
      assembled.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        path: "path" in item ? item.path : [],
      })),
    );
  const { project, checked, catalog } = assembled.value;
  const instances =
    "components" in project.presentation.scene
      ? project.presentation.scene.components.filter((item) => "component" in item)
      : project.presentation.scene;
  const programs: OpaqueRenderProgram[] = [];
  const componentPrograms = new Map<
    (typeof project.components)[number],
    Omit<OpaqueRenderProgram, "entryId" | "props" | "stateKeysById">
  >();
  for (const surface of Object.values(checked.definition.scene.surfaces)) {
    if (surface.content.kind !== "opaque") continue;
    const host = checked.definition.scene.nodes[surface.hostNodeId];
    const instance = instances.find((item) => item.id === host?.name);
    if (!instance || !("component" in instance)) throw new Error("Opaque instance missing.");
    const component = project.components.find(
      (item) =>
        item.manifest.componentId === instance?.component.id &&
        item.manifest.version === instance?.component.version,
    );
    if (!component || !("rendererSource" in component)) throw new Error("Opaque entry missing.");
    let program = componentPrograms.get(component);
    if (!program) {
      const prepared = prepareParsedLockedOpaqueBundleInput(parsed.value, component);
      if (!prepared.valid) throw new OpaquePreparationFailure(prepared.diagnostics);
      const bundle = await ports.bundle(prepared.value);
      if (!bundle.ok) throw new OpaquePreparationFailure(bundle.diagnostics);
      const sourceComponent = catalog.components.find(
        (candidate) =>
          "metadata" in candidate &&
          candidate.metadata.id === component.metadata.id &&
          candidate.metadata.version === component.metadata.version,
      );
      const localDependencies = new Set(
        sourceComponent && "metadata" in sourceComponent
          ? sourceComponent.renderer.localDependencies
          : [],
      );
      const debugLocalSourceFiles = Object.fromEntries(
        prepared.value.modules.flatMap((module) => {
          if (!module.path.startsWith("project/")) return [];
          const fileName = module.path.slice("project/".length);
          return localDependencies.has(fileName) ? [[module.path, fileName]] : [];
        }),
      );
      program = {
        moduleHash: component.lock.rendererInputHash,
        javascript: bundle.javascript,
        debugSourceMap: bundle.sourceMap,
        debugSourcePaths: prepared.value.modules.map((module) => module.path),
        debugLocalSourceFiles,
        ...(sourceComponent &&
        "metadata" in sourceComponent &&
        sourceComponent.renderer.entryOrigins
          ? { entryOrigins: sourceComponent.renderer.entryOrigins }
          : {}),
        stylesheets: bundle.stylesheets,
        assets: bundle.assets
          .filter((asset) => !asset.fileName.toLowerCase().endsWith(".css.map"))
          .map((asset) => ({
            path: asset.fileName,
            mediaType: ports.mediaTypeFor(asset.fileName),
            dataBase64: Buffer.from(asset.source).toString("base64"),
          })),
      };
      componentPrograms.set(component, program);
    }
    const props: Record<string, string | number | boolean> = {};
    for (const [key, declaration] of Object.entries(component.metadata.props)) {
      const supplied = (instance.props as Record<string, unknown>)[key];
      const value =
        supplied === undefined
          ? "default" in declaration
            ? declaration.default
            : undefined
          : supplied;
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
        throw new Error("Opaque prop missing.");
      props[key] = value;
    }
    programs.push({
      entryId: surface.id,
      ...program,
      props,
      stateKeysById: Object.fromEntries(
        Object.keys(component.metadata.states ?? { default: {} }).map((key) => [
          reactResourceId("state", instance.id, key),
          key,
        ]),
      ),
    });
  }
  return programs;
};
