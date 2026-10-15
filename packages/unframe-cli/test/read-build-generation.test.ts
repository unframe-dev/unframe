import { mkdtemp, rm, unlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import definition from "../../contracts/presentation/fixtures/presentation-definition.json";
import renderBundle from "../../contracts/presentation/fixtures/render-bundle.json";
import assetSet from "../../contracts/presentation/fixtures/asset-set-manifest.json";
import buildManifest from "../../contracts/presentation/fixtures/build-manifest.json";
import { publishAtomicArtifacts } from "../src/filesystem/atomic-output.js";
import { readBuildGeneration } from "../src/filesystem/read-build-generation.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const createBuild = async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-fixed-generation-"));
  directories.push(directory);
  const encoder = new TextEncoder();
  await publishAtomicArtifacts({
    projectDirectory: directory,
    generationId: () => "a".repeat(32),
    artifacts: {
      definition: encoder.encode(JSON.stringify(definition)),
      renderBundle: encoder.encode(JSON.stringify(renderBundle)),
      assetSet: encoder.encode(JSON.stringify(assetSet)),
      buildManifest: encoder.encode(JSON.stringify(buildManifest)),
      assets: [],
    },
  });
  return directory;
};
describe("fixed build generation", () => {
  it("pins verified artifacts even after the current pointer changes", async () => {
    const directory = await createBuild();
    const fixed = await readBuildGeneration(directory, { channel: "dist" });
    await unlink(join(directory, "dist"));
    await symlink("user-output", join(directory, "dist"));
    expect(fixed.generationId).toBe("a".repeat(32));
    expect(fixed.artifacts).toEqual({ definition, renderBundle, assetSet, buildManifest });
  });
  it("rejects canonical artifact hash drift", async () => {
    const directory = await createBuild();
    await writeFile(
      join(directory, ".unframe/generations", "a".repeat(32), "build-manifest.json"),
      JSON.stringify({ ...buildManifest, definitionHash: "sha256:" + "0".repeat(64) }),
    );
    await expect(readBuildGeneration(directory, { channel: "dist" })).rejects.toThrow(/integrity/);
  });
  it("rejects traversal generation IDs before opening an arbitrary path", async () => {
    const directory = await createBuild();
    await expect(
      readBuildGeneration(directory, { channel: "dev", generationId: "../../outside" }),
    ).rejects.toThrow(/generation/);
  });
  it("rejects unknown assets and symlinked asset files", async () => {
    const directory = await createBuild();
    const fixed = await readBuildGeneration(directory, { channel: "dist" });
    await expect(fixed.readAsset("../../secret")).rejects.toThrow(/asset/);
    await symlink(
      "/etc/passwd",
      join(directory, ".unframe/generations", fixed.generationId, "assets/texture.png"),
    );
    await expect(fixed.readAsset("texture")).rejects.toThrow(/asset/);
  });
});
