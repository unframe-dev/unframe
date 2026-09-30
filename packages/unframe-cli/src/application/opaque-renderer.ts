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
    readonly diagnostics: ReadonlyArray<{
      readonly code: string;
      readonly message: string;
      readonly path: ReadonlyArray<string | number>;
    }>,
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
  if (!assembled.valid) {
    throw new OpaquePreparationFailure(
      assembled.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        path: "path" in item ? item.path : [],
      })),
    );
  }
  const { checked, project } = assembled.value;
  const instances =
    "components" in project.presentation.scene
      ? project.presentation.scene.components.filter((item) => "component" in item)
      : project.presentation.scene;
  const runtime = await openOpaqueCaptureRuntime(signal ? { signal } : {});
  try {
    const programs: Array<OpaqueRenderProgram> = [];
    for (const surface of Object.values(checked.definition.scene.surfaces)) {
      if (surface.content.kind !== "opaque") {
        continue;
      }
      const host = checked.definition.scene.nodes[surface.hostNodeId];
      const instance = instances.find((item) => item.id === host?.name);
      if (!instance || !("component" in instance)) {
        throw new Error("Opaque instance missing.");
      }
      const component = project.components.find(
        (item) =>
          item.manifest.componentId === instance?.component.id &&
          item.manifest.version === instance?.component.version,
      );
      if (!component || !("rendererSource" in component)) {
        throw new Error("Opaque entry missing.");
      }
      const prepared = prepareLockedOpaqueBundleInput(source, component);
      if (!prepared.valid) {
        throw new OpaquePreparationFailure(prepared.diagnostics);
      }
      const bundle = await bundleOpaqueRenderer(prepared.value);
      if (!bundle.ok) {
        throw new OpaquePreparationFailure(bundle.diagnostics);
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
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
          throw new Error("Opaque prop missing.");
        }
        props[key] = value;
      }
      programs.push({
        assets: bundle.assets.map((asset) => ({
          dataBase64: Buffer.from(asset.source).toString("base64"),
          mediaType: mediaTypeFor(asset.fileName),
          path: asset.fileName,
        })),
        entryId: surface.id,
        javascript: bundle.javascript,
        moduleHash: component.lock.rendererInputHash,
        props,
        stateKeysById: Object.fromEntries(
          Object.keys(component.metadata.states ?? { default: {} }).map((key) => [
            reactResourceId("state", instance.id, key),
            key,
          ]),
        ),
        stylesheets: bundle.stylesheets,
      });
    }
    return {
      close: runtime.close,
      renderer: createOpaqueBakedWebRenderer({
        capture: runtime.capture,
        config,
        programs,
        runtimeFingerprint: runtime.fingerprint,
      }),
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
};
