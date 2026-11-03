import { type CompilerSourceAssetBytes } from "@unframe-dev/build";
import {
  createOpaqueBakedWebRenderer,
  openOpaqueCaptureRuntime,
  type WebRendererConfig,
} from "@unframe-dev/render-browser";
import { runAnalysisOperation } from "../author/analysis-client.js";

export const prepareOpaqueRenderer = async (
  source: unknown,
  carrier: unknown,
  signal: AbortSignal | undefined,
  config: WebRendererConfig,
  sourceAssetBytes: CompilerSourceAssetBytes = {},
) => {
  const programs = await runAnalysisOperation(
    "opaque",
    { source, carrier, sourceAssetBytes },
    signal,
  );
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
