import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/temporary-directory.js";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, expect, it, vi } from "vitest";
import { snapshotNodeTransformInputs } from "../src/node-snapshot.js";

vi.mock("../src/runtime.js", () => ({
  probeNodeRuntime: () => ({
    version: "v24.0.0",
    platform: "darwin",
    arch: "arm64",
    libc: "not-applicable",
  }),
}));
afterEach(() => vi.unstubAllEnvs());

it("records Darwin without NIX_LD and excludes Linux musl optional packages", async () => {
  vi.stubEnv("NIX_LD", "/does-not-exist/linux-loader");
  vi.stubEnv("NIX_LD_LIBRARY_PATH", "/linux-only-libraries");
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-darwin-runtime-"));
  try {
    await writeFile(join(root, "package.json"), "{}");
    const linux = { os: ["linux"], cpu: ["x64"], libc: ["musl"] };
    const darwin = { os: ["darwin"], cpu: ["arm64"] };
    await writeFile(
      join(root, "pnpm-lock.yaml"),
      stringify({
        lockfileVersion: "9.0",
        importers: {
          ".": {
            dependencies: { native: { version: "1.0.0" } },
            optionalDependencies: { linux: { version: "1.0.0" } },
          },
        },
        packages: {
          "native@1.0.0": { ...darwin, resolution: { integrity: "sha512-YWJj" } },
          "linux@1.0.0": { ...linux, resolution: { integrity: "sha512-YWJj" } },
        },
        snapshots: { "native@1.0.0": {}, "linux@1.0.0": {} },
      }),
    );
    for (const [name, metadata] of [
      ["native", darwin],
      ["linux", linux],
    ] as const) {
      const directory = join(root, "node_modules", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ name, version: "1.0.0", ...metadata }),
      );
    }
    const snapshot = await snapshotNodeTransformInputs(root);
    expect(snapshot.runtime).toMatchObject({
      platform: "darwin",
      arch: "arm64",
      libc: "not-applicable",
      environment: {},
    });
    expect(snapshot.packages.map((pkg) => pkg.locator)).toEqual(["native@1.0.0"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
