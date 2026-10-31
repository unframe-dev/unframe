import { expect, it } from "vitest";
import { nativeHost } from "../src/platform/host.js";

it("selects native browser and process supervision for supported hosts", () => {
  expect(nativeHost("linux", "x64")).toEqual({
    os: "linux",
    arch: "x64",
    browserCommand: "xdg-open",
    cgroup: true,
  });
  expect(nativeHost("darwin", "arm64")).toEqual({
    os: "darwin",
    arch: "arm64",
    browserCommand: "open",
    cgroup: false,
  });
});
it.each([
  ["win32", "x64"],
  ["darwin", "x64"],
  ["linux", "arm64"],
])("rejects unsupported host %s/%s", (platform, arch) => {
  expect(() => nativeHost(platform, arch)).toThrow("Unsupported native host");
});
