import { canonicalizeJsonPayload } from "@unframe/artifacts";
import { hashDependencyGraph, type UnframeLock } from "./lock.js";

type ComponentInput = {
  componentId: string;
  version: number;
  manifestHash: string;
  origin:
    | {
        kind: "local";
        entryFile: string;
        files: readonly { path: string; hash: string }[];
        sourceHash: string;
      }
    | { kind: "package"; packageKey: string; subpath: string };
} & ({ mode: "structured"; structureHash: string } | { mode: "opaque"; rendererInputHash: string });
type LockInputs = {
  componentLocks: readonly ComponentInput[];
  themeHashes: readonly { themeId: string; hash: string }[];
} & Partial<Pick<UnframeLock, "styleTransform" | "styleSourceIdentity">>;

type DependencyInputs = Pick<
  UnframeLock,
  "packageManagerLockHash" | "rootDependencies" | "packages"
>;

const encodeLock = (
  lock: Pick<
    UnframeLock,
    | "rootDependencies"
    | "packages"
    | "resolutionProfile"
    | "packageSnapshotProfile"
    | "styleTransform"
    | "styleSourceIdentity"
  > &
    Record<string, unknown>,
): Uint8Array =>
  new TextEncoder().encode(
    canonicalizeJsonPayload({ ...lock, dependencyGraphHash: hashDependencyGraph(lock) }) + "\n",
  );

export const refreshProjectLock = (previous: UnframeLock, inputs: LockInputs): Uint8Array =>
  encodeLock({ ...previous, ...inputs });

export const createProjectLock = (
  graph: DependencyInputs,
  inputs: LockInputs & Pick<UnframeLock, "assets">,
  previous?: Pick<UnframeLock, "rendererPlugins">,
): Uint8Array =>
  encodeLock({
    ...inputs,
    schemaVersion: 1,
    packageSnapshotProfile: "pnpm-lock9-locator-v1",
    resolutionProfile: "browser-import-production-types-v1",
    extractionProfile: "react-component-v1",
    packageManagerLockHash: graph.packageManagerLockHash,
    rootDependencies: graph.rootDependencies,
    packages: graph.packages,
    rendererPlugins: previous?.rendererPlugins ?? [
      { id: "baked-web", version: "3", contractVersion: "2" },
      { id: "baked-web", version: "4", contractVersion: "2" },
    ],
  });
