import {
  assembleAuthoringProject,
  prepareLockedOpaqueBundleInput,
  reactResourceId,
} from "@unframe/unframe-compiler";
import {
  bundleOpaqueRenderer,
  createOpaqueBakedWebRenderer,
  openOpaqueCaptureRuntime,
  type OpaqueRenderProgram,
  type WebRendererConfig,
} from "@unframe/unframe-renderer-web";
import { mediaTypeFor } from "../filesystem/package-snapshot.js";

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

export const prepareOpaqueRenderer = async (
  source: unknown,
  carrier: unknown,
  signal: AbortSignal | undefined,
  config: WebRendererConfig,
) => {
  const assembled = assembleAuthoringProject(source, carrier);
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
  const runtime = await openOpaqueCaptureRuntime(signal ? { signal } : {});
  try {
    const programs: OpaqueRenderProgram[] = [];
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
      const prepared = prepareLockedOpaqueBundleInput(source, component);
      if (!prepared.valid) throw new OpaquePreparationFailure(prepared.diagnostics);
      const bundle = await bundleOpaqueRenderer(prepared.value);
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
        props,
        stateKeysById: Object.fromEntries(
          Object.keys(component.metadata.states ?? { default: {} }).map((key) => [
            reactResourceId("state", instance.id, key),
            key,
          ]),
        ),
        assets: bundle.assets.map((asset) => ({
          path: asset.fileName,
          mediaType: mediaTypeFor(asset.fileName),
          dataBase64: Buffer.from(asset.source).toString("base64"),
        })),
      });
    }
    return {
      renderer: createOpaqueBakedWebRenderer({
        programs,
        config,
        runtimeFingerprint: runtime.fingerprint,
        capture: runtime.capture,
      }),
      close: runtime.close,
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
};
