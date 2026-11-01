import { prepareOpaquePrograms, type CompilerSourceAssetBytes } from "@unframe/build";
import {
  bundleOpaqueRenderer,
  createOpaqueBakedWebRenderer,
  openOpaqueCaptureRuntime,
  type WebRendererConfig,
} from "@unframe/render-browser";
import { mediaTypeFor } from "@unframe/workspace";

export const prepareOpaqueRenderer = async (
  source: unknown,
  carrier: unknown,
  signal: AbortSignal | undefined,
  config: WebRendererConfig,
  sourceAssetBytes: CompilerSourceAssetBytes = {},
) => {
  const programs = await prepareOpaquePrograms(source, carrier, sourceAssetBytes, {
    bundle: bundleOpaqueRenderer,
    mediaTypeFor,
  });
  const runtime = await openOpaqueCaptureRuntime(signal ? { signal } : {});
  try {
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
