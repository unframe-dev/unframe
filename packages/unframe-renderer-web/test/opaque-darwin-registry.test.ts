import { describe, expect, it } from "vitest";
import { encodeDarwinRegistry } from "../src/opaque/isolation/darwin-browser.js";

describe("Darwin browser identity registry boundary", () => {
  it("rejects missing fields, embedded NULs and oversized identities or policies", () => {
    expect(() => encodeDarwinRegistry([])).toThrow();
    for (const [index, value] of [
      [0, "bad\0identity"],
      [4, "x".repeat(4097)],
      [14, "x".repeat(262145)],
    ] as const) {
      const fields = Array<string>(18).fill("");
      fields[index] = value;
      expect(() => encodeDarwinRegistry(fields)).toThrow();
    }
  });

  it("does not exempt the Chromium executable when granting the native launcher escape", async () => {
    const { darwinSandboxProfile } = await import("../src/opaque/isolation/darwin.js");
    const profile = darwinSandboxProfile(
      ["/nix/store/runtime", "/nix/store/helper"],
      "/private/tmp/scratch",
      "/nix/store/helper/bin/launcher",
    );
    expect(profile.match(/with no-sandbox/g)).toHaveLength(1);
    expect(profile).toContain(
      '(allow process-exec (literal "/nix/store/helper/bin/launcher") (with no-sandbox))',
    );
    expect(profile).not.toContain("chrome-headless-shell");
    expect(profile).not.toContain('(allow process-exec (subpath "/nix/store/helper"))');
  });
});
