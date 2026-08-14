// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createViteConfig } from "./vite.config";

describe("Vite configuration", () => {
  it("does not load the Cloudflare worker during development", () => {
    const config = createViteConfig("serve");

    expect(config.plugins).toHaveLength(2);
  });

  it("loads the Cloudflare worker for production builds", () => {
    const config = createViteConfig("build");

    expect(config.plugins).toHaveLength(3);
  });
});
