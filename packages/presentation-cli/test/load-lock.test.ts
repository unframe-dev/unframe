import { hashCanonicalJsonPayload } from "@unframe/presentation-core";
import { describe, expect, it } from "vitest";

import { loadUnframeLock } from "../src/filesystem/load-lock.js";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hash = (value: unknown) => hashCanonicalJsonPayload(value);
const identity = (packageName: string, packageVersion = "1.0.0", packageIntegrity?: string) => ({
  packageName,
  packageVersion,
  packageIntegrity: packageIntegrity ?? `sha256:${"a".repeat(64)}`,
});

const lockedPackage = (overrides: Partial<Record<string, unknown>> = {}) => {
  const base = {
    ...identity("example-package"),
    files: [{ fileName: "index.ts", sourceText: "export const example = true;" }],
    exports: [{ subpath: ".", targetFile: "index.ts" }],
    dependencies: [],
  };
  const payload = { ...base, ...overrides };
  const { packageIntegrity: _ignored, ...integrityPayload } = payload;
  return { ...payload, packageIntegrity: hash(integrityPayload) };
};

const validLock = () => {
  const pkg = lockedPackage();
  return {
    schemaVersion: 1,
    packageDependencies: [
      { ...identity(pkg.packageName, pkg.packageVersion, pkg.packageIntegrity) },
    ],
    packages: [pkg],
    themeHashes: [{ themeId: "default", hash: `sha256:${"b".repeat(64)}` }],
    componentLocks: [
      {
        componentId: "example-component",
        version: 1,
        lock: {
          packageVersion: "1.0.0",
          packageIntegrity: `sha256:${"c".repeat(64)}`,
          manifestHash: `sha256:${"d".repeat(64)}`,
          structureHash: `sha256:${"e".repeat(64)}`,
        },
      },
    ],
    assets: {
      "asset-b": { id: "asset-b", mediaType: "image/png", checksum: `sha256:${"f".repeat(64)}` },
      "asset-a": { id: "asset-a", mediaType: "image/png", checksum: `sha256:${"0".repeat(64)}` },
    } as Record<string, { id: string; mediaType: string; checksum: string }>,
  };
};

describe("unframe.lock v1 boundary", () => {
  it("normalizes lock arrays and materializes typed compiler carriers", () => {
    const lock = validLock();
    lock.assets = Object.fromEntries(Object.entries(lock.assets).reverse());

    const result = loadUnframeLock(bytes(lock));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.virtualSource.packageDependencies).toEqual(lock.packageDependencies);
    expect(result.value.virtualSource.packages[0]?.files.map((item) => item.fileName)).toEqual([
      "index.ts",
    ]);
    expect(Object.keys(result.value.assemblyCarrier.assets)).toEqual(["asset-a", "asset-b"]);
    expect(result.value.lockHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result.value.virtualSource.packages[0]?.files[0])).toBe(true);
    expect(Object.isFrozen(result.value.assemblyCarrier.assets["asset-a"])).toBe(true);
  });

  it.each([
    [{ ...validLock(), extra: true }, "semantic", "cli-lock-shape-invalid"],
    [{ ...validLock(), schemaVersion: 2 }, "semantic", "cli-lock-schema-version-invalid"],
    [
      {
        ...validLock(),
        packages: [{ ...validLock().packages[0], packageIntegrity: "sha256:UPPER" }],
      },
      "semantic",
      "cli-lock-content-hash-invalid",
    ],
    [
      {
        ...validLock(),
        packages: [{ ...validLock().packages[0], packageIntegrity: `sha256:${"1".repeat(64)}` }],
      },
      "semantic",
      "cli-lock-package-integrity-mismatch",
    ],
  ] as const)("rejects invalid semantic lock data", (value, family, code) => {
    expect(loadUnframeLock(bytes(value))).toMatchObject({
      ok: false,
      diagnostic: { family, code },
    });
  });

  it("rejects nested unknown fields before materializing the package", () => {
    const lock = validLock();
    const source = lock.packages[0]!;
    const pkg = lockedPackage({ files: [{ ...source.files[0]!, extra: true }] });
    lock.packages = [pkg];
    lock.packageDependencies = [
      identity(pkg.packageName, pkg.packageVersion, pkg.packageIntegrity),
    ];
    expect(loadUnframeLock(bytes(lock))).toMatchObject({
      ok: false,
      diagnostic: { code: "cli-lock-package-file-shape-invalid" },
    });
  });

  it.each([
    ['{"schemaVersion":1,"schemaVersion":1}', "cli-lock-json-duplicate-key"],
    ["{", "cli-lock-json-syntax"],
  ])("preserves strict JSON failure as syntax diagnostic", (source, code) => {
    expect(loadUnframeLock(new TextEncoder().encode(source))).toMatchObject({
      ok: false,
      diagnostic: { family: "syntax", code },
    });
  });

  it("rejects duplicate keys, unresolved exact identities, and missing export targets", () => {
    const duplicate = validLock();
    duplicate.themeHashes = [duplicate.themeHashes[0]!, { ...duplicate.themeHashes[0]! }];
    expect(loadUnframeLock(bytes(duplicate))).toMatchObject({
      ok: false,
      diagnostic: { code: "cli-lock-duplicate-theme-id" },
    });

    const unresolved = validLock();
    unresolved.packageDependencies = [identity("missing")];
    expect(loadUnframeLock(bytes(unresolved))).toMatchObject({
      ok: false,
      diagnostic: { code: "cli-lock-package-reference-missing" },
    });

    const missingExport = validLock();
    missingExport.packages[0]!.exports = [{ subpath: ".", targetFile: "missing.ts" }];
    missingExport.packages[0] = lockedPackage(missingExport.packages[0]);
    missingExport.packageDependencies = [
      identity(
        missingExport.packages[0]!.packageName,
        missingExport.packages[0]!.packageVersion,
        missingExport.packages[0]!.packageIntegrity,
      ),
    ];
    expect(loadUnframeLock(bytes(missingExport))).toMatchObject({
      ok: false,
      diagnostic: { code: "cli-lock-package-export-target-missing" },
    });
  });
});
