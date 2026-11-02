import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalizeJsonPayload } from "@unframe/artifacts";
import {
  hashDependencyGraph,
  hashLockedPackageContent,
  hashPackageLocator,
  type PackageSnapshot,
  type UnframeLock,
} from "@unframe/workspace";
import { lockedFile } from "@unframe/workspace-node";
import { writeStyleBoundaryProjectFixture } from "./style-boundary-project-fixture.js";

export const writeAuthoringBoundaryProjectFixture = async (directory: string) => {
  await writeStyleBoundaryProjectFixture(directory);
  const sdkSource = [
    "definePresentation",
    "defineComponentManifest",
    "defineComponentStructure",
    "defineTheme",
  ]
    .map((name) => `export function ${name}<T>(value: T): T { return value; }`)
    .join("\n");
  const pkg: PackageSnapshot = {
    key: hashPackageLocator("@unframe/authoring@1.0.0"),
    locator: "@unframe/authoring@1.0.0",
    name: "@unframe/authoring",
    version: "1.0.0",
    contentIntegrity: `sha256:${"0".repeat(64)}`,
    files: [lockedFile("index.ts", new TextEncoder().encode(sdkSource))],
    exports: [{ subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" }],
    dependencies: [],
  };
  pkg.contentIntegrity = hashLockedPackageContent(pkg);
  const lock: UnframeLock = {
    schemaVersion: 1,
    packageSnapshotProfile: "pnpm-lock9-locator-v1",
    resolutionProfile: "browser-import-production-types-v1",
    extractionProfile: "react-component-v1",
    packageManagerLockHash: `sha256:${"0".repeat(64)}`,
    rootDependencies: [{ specifier: "@unframe/authoring", usage: "runtime", packageKey: pkg.key }],
    packages: [pkg],
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
  await writeFile(
    join(directory, "presentation.unframe.tsx"),
    `
import { definePresentation } from "@unframe/authoring";
export default definePresentation({
  id: "boundary-project", metadata: { title: "Boundary" },
  stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] },
  assets: [], scene: [], operations: [],
  flow: { initialGroupId: "main", groups: { main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } } }, variables: {} },
});
`,
  );
};
