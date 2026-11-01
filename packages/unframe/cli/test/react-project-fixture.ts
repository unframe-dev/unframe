import { sourceAssetPorts } from "../src/application/media-ports.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalizeJsonPayload } from "@unframe/artifacts";
import { checkAuthoringProject } from "@unframe/source";
import { hashDependencyGraph, hashLockedPackageContent, loadUnframeLock } from "@unframe/workspace";
import { lockedFile } from "@unframe/workspace-node";
import { discoverPresentationProjectFiles } from "@unframe/workspace-node";
import { prepareProjectSource } from "@unframe/workspace-node";
import { prepareProjectFixture } from "./prepared-project-fixture.js";
import { sdkFixtureSource } from "./authoring-sdk-fixture.js";

export const prepareReactProjectFixture = async () => {
  const directory = await prepareProjectFixture();
  const found = await discoverPresentationProjectFiles(directory);
  if (!found.ok) throw new Error(found.code);
  const loaded = loadUnframeLock(found.lockBytes);
  if (!loaded.ok) throw new Error(loaded.diagnostic.code);
  const { source } = await prepareProjectSource(sourceAssetPorts.styles, found, loaded.value.lock);
  const checked = checkAuthoringProject(source);
  if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
  const original = loaded.value.lock.packages.find((item) => item.name === "@unframe/authoring");
  if (!original) throw new Error("Authoring fixture package is missing");
  const { contentIntegrity: _integrity, ...metadata } = original;
  const small = {
    ...metadata,
    files: [lockedFile("index.ts", new TextEncoder().encode(sdkFixtureSource))],
    exports: [{ subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" }],
    dependencies: [],
  };
  const graph = {
    ...loaded.value.lock,
    packages: [{ ...small, contentIntegrity: hashLockedPackageContent(small) }],
    rootDependencies: loaded.value.lock.rootDependencies.filter(
      (edge) => edge.specifier === "@unframe/authoring",
    ),
    assets: [],
  };
  await writeFile(
    join(directory, "unframe.lock"),
    canonicalizeJsonPayload({ ...graph, dependencyGraphHash: hashDependencyGraph(graph) }) + "\n",
  );
  return { directory, presentation: checked.value.presentation.value };
};
