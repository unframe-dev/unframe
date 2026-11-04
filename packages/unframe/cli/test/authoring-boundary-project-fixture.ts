import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installFixtureGraph } from "./installed-project-fixture.js";
import {
  hashLockedPackageContent,
  hashPackageLocator,
  type PackageSnapshot,
} from "@unframe-dev/workspace";
import { lockedFile } from "@unframe-dev/workspace-node";
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
    key: hashPackageLocator("@unframe-dev/authoring@1.0.0"),
    locator: "@unframe-dev/authoring@1.0.0",
    name: "@unframe-dev/authoring",
    version: "1.0.0",
    contentIntegrity: `sha256:${"0".repeat(64)}`,
    files: [lockedFile("index.ts", new TextEncoder().encode(sdkSource))],
    exports: [{ subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" }],
    dependencies: [],
  };
  pkg.contentIntegrity = hashLockedPackageContent(pkg);
  await installFixtureGraph(directory, {
    packages: [pkg],
    rootDependencies: [{ specifier: pkg.name, usage: "runtime", packageKey: pkg.key }],
  });
  await writeFile(
    join(directory, "presentation.unframe.tsx"),
    `
import { definePresentation } from "@unframe-dev/authoring";
export default definePresentation({
  id: "boundary-project", metadata: { title: "Boundary" },
  stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] },
  assets: [], scene: [], operations: [],
  flow: { initialGroupId: "main", groups: { main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } } }, variables: {} },
});
`,
  );
};
