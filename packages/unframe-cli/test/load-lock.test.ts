import { createHash } from "node:crypto";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { describe, expect, it } from "vitest";

import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import {
  hashDependencyGraph,
  hashLocalSource,
  hashLockedPackageContent,
  hashPackageLocator,
  type UnframeLockV2,
} from "../src/filesystem/lock-v2.js";

const digest = (value: string | Uint8Array): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const bytes = (value: unknown) => new TextEncoder().encode(canonicalizeJsonPayload(value) + "\n");
const componentBytes = "export const Component = 1;";
const localFiles = [{ path: "src/card.component.tsx", hash: digest(componentBytes) }];
const packageFile = "export const value = 1;";

const validLock = (): UnframeLockV2 => {
  const pkg: UnframeLockV2["packages"][number] = {
    key: hashPackageLocator("example-package@1.0.0"),
    locator: "example-package@1.0.0",
    name: "example-package",
    version: "1.0.0",
    contentIntegrity: digest("unused"),
    files: [
      {
        path: "index.js",
        mediaType: "text/javascript",
        hash: digest(packageFile),
        encoding: "utf8",
        data: packageFile,
      },
    ],
    exports: [{ subpath: ".", runtimeImport: "index.js", runtimeRequire: null, types: null }],
    dependencies: [],
  };
  pkg.contentIntegrity = hashLockedPackageContent(pkg);
  const lock: UnframeLockV2 = {
    schemaVersion: 2,
    packageSnapshotProfile: "pnpm-lock9-locator-v1",
    resolutionProfile: "browser-import-production-types-v1",
    extractionProfile: "react-component-v1",
    packageManagerLockHash: digest("pnpm-lock"),
    rootDependencies: [{ specifier: "example-package", usage: "runtime", packageKey: pkg.key }],
    packages: [pkg],
    dependencyGraphHash: digest("unused"),
    themeHashes: [{ themeId: "default", hash: digest("theme") }],
    componentLocks: [
      {
        componentId: "card",
        version: 1,
        origin: {
          kind: "local",
          entryFile: "src/card.component.tsx",
          files: localFiles,
          sourceHash: hashLocalSource("src/card.component.tsx", localFiles),
        },
        manifestHash: digest("manifest"),
        mode: "opaque",
        rendererInputHash: digest("renderer"),
      },
    ],
    assets: [
      {
        id: "font",
        mediaType: "font/ttf",
        hash: digest(new Uint8Array([1, 2, 3])),
        size: 3,
        dataBase64: "AQID",
      },
    ],
    rendererPlugins: [
      { id: "baked-web", version: "3", contractVersion: "2" },
      { id: "baked-web", version: "4", contractVersion: "2" },
    ],
  };
  lock.dependencyGraphHash = hashDependencyGraph(lock);
  return lock;
};

const errorCode = (lock: unknown) => {
  const result = loadUnframeLock(bytes(lock));
  return result.ok ? "ok" : result.diagnostic.code;
};

describe("unframe.lock v2 boundary", () => {
  it("loads a frozen local Component and package graph", () => {
    const lock = validLock();
    const result = loadUnframeLock(bytes(lock));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.virtualSource.rootDependencies).toEqual(lock.rootDependencies);
    expect(result.value.assemblyCarrier.componentLocks[0]).toMatchObject({
      componentId: "card",
      mode: "opaque",
    });
    expect(result.value.assemblyCarrier.assets.font).toMatchObject({
      checksum: lock.assets[0]?.hash,
    });
  });

  it("rejects v1 and unknown nested fields", () => {
    expect(errorCode({ ...validLock(), schemaVersion: 1 })).toBe("cli-lock-shape-invalid");
    const lock = validLock();
    lock.packages[0]!.files[0] = { ...lock.packages[0]!.files[0]!, extra: 1 } as never;
    expect(errorCode(lock)).toBe("cli-lock-shape-invalid");
  });

  it("requires explicit renderer pins and directs old locks to refresh", () => {
    const { rendererPlugins: _removed, ...withoutPins } = validLock();
    expect(errorCode(withoutPins)).toBe("cli-lock-renderer-plugins-refresh-required");
  });

  it("rejects changed package bytes and graph edges", () => {
    const bytesChanged = validLock();
    bytesChanged.packages[0]!.files[0] = {
      ...bytesChanged.packages[0]!.files[0]!,
      data: "changed",
    };
    expect(errorCode(bytesChanged)).toBe("cli-lock-package-file-hash-invalid");

    const graphChanged = validLock();
    graphChanged.rootDependencies[0]!.usage = "types";
    expect(errorCode(graphChanged)).toBe("cli-lock-graph-hash-mismatch");
  });

  it("rejects a package file whose claimed media type disagrees with its path", () => {
    const lock = validLock();
    lock.packages[0]!.files[0]!.mediaType = "image/png";
    expect(errorCode(lock)).toBe("cli-lock-package-file-media-invalid");
  });

  it("rejects invalid binary, missing references, and unreachable packages", () => {
    const invalidAsset = validLock();
    invalidAsset.assets[0]!.dataBase64 = "AQI=";
    expect(errorCode(invalidAsset)).toBe("cli-lock-asset-hash-invalid");

    const missing = validLock();
    missing.rootDependencies[0]!.packageKey = digest("missing");
    expect(errorCode(missing)).toBe("cli-lock-package-reference-missing");

    const unused = validLock();
    unused.rootDependencies = [];
    unused.dependencyGraphHash = hashDependencyGraph(unused);
    expect(errorCode(unused)).toBe("cli-lock-package-unreferenced");
  });

  it("requires a package Component origin to name a frozen export", () => {
    const lock = validLock();
    lock.componentLocks[0]!.origin = {
      kind: "package",
      packageKey: lock.packages[0]!.key,
      subpath: "./private",
    };
    expect(errorCode(lock)).toBe("cli-lock-component-export-missing");
  });

  it("rejects a changed local Component source closure", () => {
    const lock = validLock();
    const origin = lock.componentLocks[0]!.origin;
    if (origin.kind !== "local") throw new Error("Expected local Component");
    origin.files[0]!.hash = digest("changed");
    expect(errorCode(lock)).toBe("cli-lock-local-source-hash-mismatch");
  });

  it("orders Component versions numerically beyond ten digits", () => {
    const lock = validLock();
    lock.componentLocks = [
      { ...lock.componentLocks[0]!, version: 9_999_999_999 },
      { ...lock.componentLocks[0]!, version: 10_000_000_000 },
    ];
    expect(errorCode(lock)).toBe("ok");
  });

  it("rejects duplicate JSON keys and invalid UTF-8", () => {
    expect(
      loadUnframeLock(new TextEncoder().encode('{"schemaVersion":2,"schemaVersion":2}')),
    ).toMatchObject({
      ok: false,
      diagnostic: { family: "syntax", code: "cli-lock-json-duplicate-key" },
    });
    expect(loadUnframeLock(new Uint8Array([0xff]))).toMatchObject({
      ok: false,
      diagnostic: { family: "syntax" },
    });
  });

  it("rejects a valid lock serialized with noncanonical whitespace", () => {
    expect(
      loadUnframeLock(new TextEncoder().encode(JSON.stringify(validLock(), null, 2))),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "cli-lock-not-canonical" },
    });
  });
});
