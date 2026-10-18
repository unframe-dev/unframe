import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, vi, assert } from "vitest";
import { managedHeadlessShell, nativeBrowserPlatform } from "../src/browser/runtime-environment.js";
import {
  hash,
  normalizedEnvironment,
  snapshotEnvironment,
} from "../src/config/config-environment.js";
import { environment } from "./fixtures/static-renderer.js";

it.each([
  [
    "linux",
    "x64",
    "/cache/chromium-1234/chrome-linux64/chrome",
    "/cache/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
  ],
  [
    "linux",
    "arm64",
    "/cache/chromium-1234/chrome-linux/chrome",
    "/cache/chromium_headless_shell-1234/chrome-linux/headless_shell",
  ],
  [
    "darwin",
    "arm64",
    "/cache/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/cache/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  ],
])("resolves the pinned managed headless shell for %s %s", (os, arch, executable, expected) => {
  expect(managedHeadlessShell(executable, os, arch).executablePath).toBe(expected);
});

it.each([
  ["win32", "x64"],
  ["darwin", "x64"],
])("rejects unsupported %s %s", (os, arch) => {
  expect(() => managedHeadlessShell("/cache/chromium-1234/chrome", os, arch)).toThrow(
    "supports Linux",
  );
});

it.each([
  { ...environment.platform, os: "darwin" as const },
  { ...environment.platform, arch: "arm64" as const },
  { ...environment.platform, fingerprint: "sha256:changed-runtime" },
])("propagates platform differences into the normalized cache identity", (platform) => {
  const changed = snapshotEnvironment({ ...environment, platform });
  assert.isDefined(changed);
  expect(hash(normalizedEnvironment(changed))).not.toBe(hash(normalizedEnvironment(environment)));
});

it("rejects a missing platform identity", () => {
  const { platform: _platform, ...missing } = environment;
  expect(snapshotEnvironment(missing)).toBeUndefined();
});

it("fingerprints browser, font and runtime bytes within the same native platform", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-platform-"));
  try {
    const browser = join(directory, "browser");
    const fonts = join(directory, "fonts");
    await mkdir(browser);
    await mkdir(fonts);
    await writeFile(join(browser, "headless_shell"), "browser-one");
    await writeFile(join(fonts, "font.otf"), "font-one");
    const config = join(directory, "fonts.conf");
    const closure = join(directory, "store-paths");
    await writeFile(config, "fixed-config");
    await writeFile(closure, "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-runtime\n");
    vi.stubEnv("FONTCONFIG_FILE", config);
    vi.stubEnv("UNFRAME_PRESENTATION_FONT_DIRECTORY", fonts);
    vi.stubEnv("UNFRAME_OPAQUE_RUNTIME_CLOSURE", closure);
    const first = await nativeBrowserPlatform(browser);
    expect((await nativeBrowserPlatform(browser)).fingerprint).toBe(first.fingerprint);
    await writeFile(join(browser, "headless_shell"), "browser-two");
    const browserChanged = await nativeBrowserPlatform(browser);
    expect(browserChanged.fingerprint).not.toBe(first.fingerprint);
    await writeFile(join(fonts, "font.otf"), "font-two");
    const fontsChanged = await nativeBrowserPlatform(browser);
    expect(fontsChanged.fingerprint).not.toBe(browserChanged.fingerprint);
    await writeFile(closure, "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-runtime\n");
    expect((await nativeBrowserPlatform(browser)).fingerprint).not.toBe(fontsChanged.fingerprint);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
