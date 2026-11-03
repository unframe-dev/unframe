import { sourceAssetPorts } from "../src/application/media-ports.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { checkAuthoringProject } from "@unframe-dev/source";
import { hashLockedPackageContent, hashPackageLocator } from "@unframe-dev/workspace";
import {
  lockedFile,
  discoverPresentationProjectFiles,
  prepareProjectSource,
} from "@unframe-dev/workspace-node";
import { prepareProjectFixture } from "./prepared-project-fixture.js";
import { installFixtureGraph } from "./installed-project-fixture.js";
import { sdkFixtureSource } from "./authoring-sdk-fixture.js";

export const prepareReactProjectFixture = async () => {
  const directory = await prepareProjectFixture();
  await rm(join(directory, "node_modules"), { recursive: true, force: true });
  const locator = "@unframe-dev/authoring@1.0.0";
  const pkg = {
    key: hashPackageLocator(locator),
    locator,
    name: "@unframe-dev/authoring",
    version: "1.0.0",
    files: [lockedFile("index.ts", new TextEncoder().encode(sdkFixtureSource))],
    exports: [{ subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" }],
    dependencies: [],
    contentIntegrity: "sha256:" as `sha256:${string}`,
  };
  pkg.contentIntegrity = hashLockedPackageContent(pkg);
  await installFixtureGraph(directory, {
    packages: [pkg],
    rootDependencies: [{ specifier: pkg.name, usage: "runtime", packageKey: pkg.key }],
  });
  const found = await discoverPresentationProjectFiles(directory);
  if (!found.ok) throw new Error(found.code);
  const { source } = await prepareProjectSource(
    sourceAssetPorts.styles,
    found,
    found.dependencyGraph,
  );
  const checked = checkAuthoringProject(source);
  if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
  return { directory, presentation: checked.value.presentation.value };
};
