import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalizeJsonPayload } from "@unframe/artifacts";
import { hashDependencyGraph, type UnframeLock } from "@unframe/workspace";
import { writeDiscoveryProjectFixture } from "./discovery-project-fixture.js";

export const writeStyleBoundaryProjectFixture = async (directory: string) => {
  await writeDiscoveryProjectFixture(directory);
  const lock: UnframeLock = {
    schemaVersion: 1,
    packageSnapshotProfile: "pnpm-lock9-locator-v1",
    resolutionProfile: "browser-import-production-types-v1",
    extractionProfile: "react-component-v1",
    packageManagerLockHash: `sha256:${"0".repeat(64)}`,
    rootDependencies: [],
    packages: [],
    dependencyGraphHash: `sha256:${"0".repeat(64)}`,
    themeHashes: [],
    componentLocks: [],
    assets: [],
    rendererPlugins: [
      { id: "baked-web", version: "3", contractVersion: "2" },
      { id: "baked-web", version: "4", contractVersion: "2" },
    ],
  };
  lock.dependencyGraphHash = hashDependencyGraph(lock);
  await writeFile(join(directory, "unframe.lock"), canonicalizeJsonPayload(lock) + "\n");
};
