import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { release, version, machine } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { hash } from "../config/config-environment.js";
import type { FixedBrowserEnvironment } from "../public-types.js";
import { fingerprintOpaqueRuntimeDirectory } from "../opaque/capture/runtime-snapshot.js";

// Layouts are pinned to playwright-core 1.62.1's executable registry.
export const managedHeadlessShell = (
  chromiumPath: string = chromium.executablePath(),
  os: string = process.platform,
  arch: string = process.arch,
) => {
  const match = /^(.*)\/chromium-(\d+)\//.exec(chromiumPath);
  if (!match) throw new Error("Managed Chromium path does not match the pinned registry.");
  const layout =
    os === "linux" && arch === "x64"
      ? ["chrome-headless-shell-linux64", "chrome-headless-shell"]
      : os === "linux" && arch === "arm64"
        ? ["chrome-linux", "headless_shell"]
        : os === "darwin" && arch === "arm64"
          ? ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"]
          : undefined;
  if (!layout) throw new Error("Fixed Browser supports Linux and Apple Silicon macOS only.");
  const directory = join(match[1]!, `chromium_headless_shell-${match[2]}`, layout[0]!);
  return { directory, executablePath: join(directory, layout[1]!) };
};

const fileHash = async (path: string) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
};

export const nativeBrowserPlatform = async (
  browserDirectory = managedHeadlessShell(chromium.executablePath()).directory,
): Promise<FixedBrowserEnvironment["platform"]> => {
  const os = process.platform;
  const arch = process.arch;
  if (
    (os !== "linux" && os !== "darwin") ||
    (arch !== "x64" && arch !== "arm64") ||
    (os === "darwin" && arch !== "arm64")
  )
    throw new Error("Fixed Browser supports Linux and Apple Silicon macOS only.");
  const closureFile = process.env.UNFRAME_OPAQUE_RUNTIME_CLOSURE;
  const fontDirectory = process.env.UNFRAME_PRESENTATION_FONT_DIRECTORY;
  const fontConfig = process.env.FONTCONFIG_FILE;
  if (!closureFile || !fontDirectory || !fontConfig)
    throw new Error("Pinned browser runtime closure and font environment are required.");
  const closure = (await readFile(closureFile, "utf8")).trim().split("\n").sort();
  if (
    closure.length === 0 ||
    closure.some((path) => !/^\/nix\/store\/[a-z0-9]{32}-[^/\s]+$/.test(path))
  )
    throw new Error("Pinned browser runtime closure is invalid.");
  const packagePath = createRequire(import.meta.url).resolve("playwright-core/package.json");
  const playwrightPin = await fileHash(packagePath);
  const browserRegistry = await fileHash(join(dirname(packagePath), "browsers.json"));
  const nodePath = await realpath(process.execPath);
  const workerNodePath = await realpath(process.env.UNFRAME_OPAQUE_NODE ?? process.execPath);
  const [browserHash, fontsHash, fontConfigHash, nodeHash, workerNodeHash] = await Promise.all([
    fingerprintOpaqueRuntimeDirectory(await realpath(browserDirectory)),
    fingerprintOpaqueRuntimeDirectory(await realpath(fontDirectory)),
    fileHash(fontConfig),
    fileHash(nodePath),
    fileHash(workerNodePath),
  ]);
  return Object.freeze({
    os,
    arch,
    fingerprint: hash({
      os,
      arch,
      release: release(),
      version: version(),
      machine: machine(),
      node: { versions: process.versions, executable: nodeHash, workerExecutable: workerNodeHash },
      closure,
      playwrightPin,
      browserRegistry,
      browserHash,
      fontsHash,
      fontConfigHash,
      loader:
        os === "linux"
          ? { nixLd: process.env.NIX_LD, libraryPath: process.env.NIX_LD_LIBRARY_PATH }
          : undefined,
    }),
  });
};
