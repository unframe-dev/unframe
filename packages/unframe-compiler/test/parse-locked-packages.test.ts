import { describe, expect, it } from "vitest";

import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";

const packageEntry = () => ({
  packageName: "@unframe/theme",
  packageVersion: "1.0.0",
  packageIntegrity: "opaque-integrity",
  files: [{ fileName: "index.d.ts", sourceText: "export declare const theme: string;" }],
  exports: [{ subpath: ".", targetFile: "index.d.ts" }],
  dependencies: [] as {
    packageName: string;
    packageVersion: string;
    packageIntegrity: string;
  }[],
});

const input = () => ({
  projectRoot: "/virtual/presentation",
  entryFile: "presentation.unframe.ts",
  files: [{ fileName: "presentation.unframe.ts", sourceText: "export {};" }],
  packageDependencies: [
    {
      packageName: "@unframe/theme",
      packageVersion: "1.0.0",
      packageIntegrity: "opaque-integrity",
    },
  ],
  packages: [packageEntry()],
});

describe("parseAuthoringProject locked packages", () => {
  it("snapshots and parses locked package TS/TSX/declaration sources with provenance", () => {
    const result = parseAuthoringProject(input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.packageDependencies).toEqual(input().packageDependencies);
    expect(result.value.packages).toHaveLength(1);
    expect(result.value.packages[0]).toMatchObject({
      packageName: "@unframe/theme",
      packageVersion: "1.0.0",
      packageIntegrity: "opaque-integrity",
      exports: [{ subpath: ".", targetFile: "index.d.ts" }],
      dependencies: [],
    });
    expect(result.value.packages[0]?.files["index.d.ts"]?.fileName).toBe(
      "unframe-package://p00400075006E006600720061006D0065002F007400680065006D0065/p0031002E0030002E0030/p006F00700061007100750065002D0069006E0074006500670072006900740079/index.d.ts",
    );
  });

  it("fails closed for hostile package shapes and invalid package metadata", () => {
    const accessor = input();
    Object.defineProperty(accessor.packages[0]!, "files", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    const prototypeField = input();
    Object.defineProperty(prototypeField.packages[0]!, "__proto__", {
      value: {},
      enumerable: true,
    });
    const proxy = input();
    proxy.packages = [
      new Proxy(proxy.packages[0]!, {
        ownKeys() {
          throw new Error("must not run");
        },
      }),
    ];
    const invalidName = input();
    invalidName.packages[0]!.packageName = ".not-a-package";
    const emptyIntegrity = input();
    emptyIntegrity.packages[0]!.packageIntegrity = "";

    for (const [value, expected] of [
      [accessor, ["compiler-invalid-input"]],
      [prototypeField, ["compiler-invalid-input"]],
      [proxy, ["compiler-invalid-input"]],
      [invalidName, ["compiler-package-identity-invalid"]],
      [emptyIntegrity, ["compiler-package-identity-invalid"]],
    ] as const) {
      const result = parseAuthoringProject(value);
      expect(result.ok).toBe(false);
      if (!result.ok)
        for (const code of expected)
          expect(result.diagnostics.map((item) => item.code)).toContain(code);
    }
  });

  it("rejects duplicate identities, paths, exports, invalid export targets, and mismatched dependencies", () => {
    const duplicatePackage = input();
    duplicatePackage.packages.push({ ...packageEntry(), packageVersion: "2.0.0" });
    const duplicateFile = input();
    duplicateFile.packages[0]!.files.push({ ...duplicateFile.packages[0]!.files[0]! });
    const duplicateExport = input();
    duplicateExport.packages[0]!.exports.push({ ...duplicateExport.packages[0]!.exports[0]! });
    const invalidExport = input();
    invalidExport.packages[0]!.exports = [{ subpath: "not-relative", targetFile: "missing.ts" }];
    const mismatch = input();
    mismatch.packageDependencies[0]!.packageIntegrity = "different";

    for (const [value, expected] of [
      [duplicatePackage, ["compiler-package-duplicate"]],
      [duplicateFile, ["compiler-package-file-duplicate"]],
      [duplicateExport, ["compiler-package-export-duplicate"]],
      [
        invalidExport,
        ["compiler-package-export-subpath-invalid", "compiler-package-export-target-missing"],
      ],
      [mismatch, ["compiler-package-dependency-mismatch"]],
    ] as const) {
      const result = parseAuthoringProject(value);
      expect(result.ok).toBe(false);
      if (!result.ok)
        for (const code of expected)
          expect(result.diagnostics.map((item) => item.code)).toContain(code);
    }
  });

  it("orders package syntax diagnostics independently of input order", () => {
    const value = input();
    value.packages = [
      {
        ...packageEntry(),
        packageName: "z-package",
        files: [{ fileName: "index.ts", sourceText: "export const z = ;" }],
        exports: [{ subpath: ".", targetFile: "index.ts" }],
      },
      {
        ...packageEntry(),
        packageName: "a-package",
        files: [{ fileName: "index.ts", sourceText: "export const a = ;" }],
        exports: [{ subpath: ".", targetFile: "index.ts" }],
      },
    ];
    value.packageDependencies = value.packages.map(
      ({ packageName, packageVersion, packageIntegrity }) => ({
        packageName,
        packageVersion,
        packageIntegrity,
      }),
    );

    const result = parseAuthoringProject(value);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        { fileName: "a-package@1.0.0/index.ts", code: "compiler-source-syntax-error" },
        { fileName: "z-package@1.0.0/index.ts", code: "compiler-source-syntax-error" },
      ],
    });
  });

  it("compares opaque identities without delimiter collisions", () => {
    const value = input();
    value.packages = [
      {
        ...packageEntry(),
        packageVersion: "one\0two",
        packageIntegrity: "three",
      },
    ];
    value.packageDependencies = [
      { packageName: "@unframe/theme", packageVersion: "one", packageIntegrity: "two\0three" },
    ];

    const result = parseAuthoringProject(value);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "compiler-package-dependency-mismatch" }],
    });
  });

  it("rejects duplicate dependency identities within each owner but permits separate owners", () => {
    const projectDuplicate = input();
    projectDuplicate.packageDependencies.push({ ...projectDuplicate.packageDependencies[0]! });
    const packageDuplicate = input();
    packageDuplicate.packages[0]!.dependencies = [
      { ...packageDuplicate.packageDependencies[0]! },
      { ...packageDuplicate.packageDependencies[0]! },
    ];
    const separateOwners = input();
    separateOwners.packages.push({
      ...packageEntry(),
      packageName: "other-package",
      dependencies: [{ ...separateOwners.packageDependencies[0]! }],
    });
    separateOwners.packageDependencies.push({
      packageName: "other-package",
      packageVersion: "1.0.0",
      packageIntegrity: "opaque-integrity",
    });

    for (const value of [projectDuplicate, packageDuplicate]) {
      const result = parseAuthoringProject(value);
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [{ code: "compiler-package-dependency-duplicate" }],
      });
    }
    expect(parseAuthoringProject(separateOwners).ok).toBe(true);
  });

  it("keeps raw opaque versions in diagnostic display while parsing through a safe virtual namespace", () => {
    const value = input();
    value.packages[0]!.packageVersion = "1/../evil";
    value.packageDependencies[0]!.packageVersion = "1/../evil";
    value.packages[0]!.files = [{ fileName: "index.ts", sourceText: "export const value = ;" }];
    value.packages[0]!.exports = [{ subpath: ".", targetFile: "index.ts" }];

    expect(parseAuthoringProject(value)).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "compiler-source-syntax-error",
          fileName: "@unframe/theme@1/../evil/index.ts",
        },
      ],
    });

    const valid = input();
    valid.packages[0]!.packageVersion = "1/../evil";
    valid.packageDependencies[0]!.packageVersion = "1/../evil";
    const parsed = parseAuthoringProject(valid);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.value.packages[0]?.files["index.d.ts"]?.fileName).toBe(
        "unframe-package://p00400075006E006600720061006D0065002F007400680065006D0065/p0031002F002E002E002F006500760069006C/p006F00700061007100750065002D0069006E0074006500670072006900740079/index.d.ts",
      );
  });

  it("escapes dot-only opaque version and integrity segments in virtual source paths", () => {
    const cases = [
      {
        packageVersion: ".",
        packageIntegrity: "opaque-integrity",
        expected: "p002E/p006F00700061007100750065002D0069006E0074006500670072006900740079",
      },
      { packageVersion: "1", packageIntegrity: "..", expected: "p0031/p002E002E" },
    ] as const;

    for (const { packageVersion, packageIntegrity, expected } of cases) {
      const value = input();
      value.packages[0]!.packageVersion = packageVersion;
      value.packages[0]!.packageIntegrity = packageIntegrity;
      value.packageDependencies[0]!.packageVersion = packageVersion;
      value.packageDependencies[0]!.packageIntegrity = packageIntegrity;

      const result = parseAuthoringProject(value);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.packages[0]?.files["index.d.ts"]?.fileName).toBe(
          `unframe-package://p00400075006E006600720061006D0065002F007400680065006D0065/${expected}/index.d.ts`,
        );
    }
  });

  it("accepts lone-surrogate opaque identities without throwing while preserving a safe namespace", () => {
    const value = input();
    value.packages[0]!.packageVersion = "\ud800";
    value.packageDependencies[0]!.packageVersion = "\ud800";

    expect(() => parseAuthoringProject(value)).not.toThrow();
    const result = parseAuthoringProject(value);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.packages[0]?.files["index.d.ts"]?.fileName).toContain("/pD800/");
  });

  it("enforces current npm package-name length and scoped leading-character rules", () => {
    const withName = (packageName: string) => {
      const value = input();
      value.packages[0]!.packageName = packageName;
      value.packageDependencies[0]!.packageName = packageName;
      return value;
    };

    for (const packageName of [
      "a".repeat(214),
      "@scope/_foo",
      "@scope/.foo",
      "@scope/-foo",
      "foo-bar",
    ])
      expect(parseAuthoringProject(withName(packageName)).ok).toBe(true);
    for (const packageName of [
      "a".repeat(215),
      "_foo",
      ".foo",
      "-foo",
      "excited!",
      "a~b",
      "a*b",
      "a'b",
      "a(b)",
      "@scope/excited!",
      "@scope/a~b",
      "@scope/a*b",
      "@scope/a'b",
      "@scope/a(b)",
    ]) {
      const result = parseAuthoringProject(withName(packageName));
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.diagnostics.map((item) => item.code)).toContain(
          "compiler-package-identity-invalid",
        );
    }
  });
});
