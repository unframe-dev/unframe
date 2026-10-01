export { createBakedWebRenderer } from "./rendering/baked-web-renderer.js";
export { combineBakedWebRenderers } from "./rendering/combined-renderer.js";

export { createWebRendererConfigHash } from "./config/config-environment.js";

export { openPlaywrightFixedBrowser } from "./browser/playwright-fixed-browser.js";

export {
  bundleOpaqueRenderer,
  type OpaqueBundleDiagnostic,
  type OpaqueRendererBundleInput,
  type OpaqueRendererBundleResult,
  type OpaqueRendererModule,
  type OpaqueRendererModuleType,
} from "./opaque/bundle-opaque-renderer.js";

export type {
  BrowserCaptureRequest,
  BrowserRgbaCapture,
  CreateBakedWebRendererOptions,
  FixedBrowserAdapter,
  FixedBrowserEnvironment,
  FixedBrowserSession,
  WebRendererConfig,
} from "./public-types.js";

export { openOpaqueCaptureRuntime } from "./opaque/capture/runtime.js";
export {
  createOpaqueBakedWebRenderer,
  type OpaqueRenderProgram,
} from "./opaque/capture/renderer.js";
