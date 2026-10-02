// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createViteConfig } from "./vite.config";
import { unityPreviewBuildRoot } from "./unity-preview-dev-plugin";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

describe("Vite configuration", () => {
  it("does not load the Cloudflare worker during development", () => {
    const config = createViteConfig("serve");

    expect(config.plugins.map((plugin) => plugin.name)).toContain("unity-preview-dev");
    expect(config.plugins).toHaveLength(3);
  });

  it("loads the Cloudflare worker for production builds", () => {
    const config = createViteConfig("build");

    expect(config.plugins).toHaveLength(3);
    expect(config.plugins.map((plugin) => plugin.name)).not.toContain("unity-preview-dev");
    const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
    expect(relative(publicRoot, unityPreviewBuildRoot)).toMatch(/^\.\./);
  });
});
