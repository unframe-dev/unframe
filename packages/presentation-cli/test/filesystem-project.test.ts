import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";

const directories: string[] = [];
const links: string[] = [];

const project = async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-project-"));
  directories.push(directory);
  await writeFile(join(directory, "unframe.lock"), "{}", "utf8");
  await writeFile(join(directory, "presentation.unframe.tsx"), "export default {}", "utf8");
  await writeFile(
    join(directory, "unframe.config.ts"),
    'export default { entryFile: "presentation.unframe.tsx" }',
    "utf8",
  );
  return directory;
};

afterEach(async () => {
  await Promise.all(links.splice(0).map((link) => unlink(link).catch(() => undefined)));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("filesystem project discovery", () => {
  it("絶対rootだけからdata-only configを読み、entryをroot内regular fileへ限定する", async () => {
    const directory = await project();
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: true,
      entryFile: "presentation.unframe.tsx",
    });
  });

  it("末尾slashを持つabsolute rootをrealpath済みrootとして受理する", async () => {
    const directory = await project();
    await expect(discoverPresentationProjectFiles(`${directory}/`)).resolves.toMatchObject({
      ok: true,
      projectDirectory: directory,
    });
  });

  it("lock validation前のraw bytesをdescriptor snapshot用copyとして返す", async () => {
    const directory = await project();
    await writeFile(join(directory, "unframe.lock"), "raw-lock", "utf8");
    const result = await discoverPresentationProjectFiles(directory);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(new TextDecoder().decode(result.lockBytes)).toBe("raw-lock");
      result.lockBytes[0] = 0;
    }
    const second = await discoverPresentationProjectFiles(directory);
    expect(second).toMatchObject({ ok: true });
    if (second.ok) expect(new TextDecoder().decode(second.lockBytes)).toBe("raw-lock");
  });

  it.each([
    'import x from "x"; export default { entryFile: "presentation.unframe.tsx" }',
    "export default { entryFile: dynamic }",
    'export default { entryFile: "a", entryFile: "b" }',
    'export default { ["entryFile"]: "a" }',
    'export default { "entryFile": "presentation.unframe.tsx" }',
    'export = { entryFile: "presentation.unframe.tsx" }',
    'export default { ...{ entryFile: "presentation.unframe.tsx" } }',
    'export default { get entryFile() { return "presentation.unframe.tsx" } }',
    'export default { entryFile() { return "presentation.unframe.tsx" } }',
    'export default { entryFile: "presentation.unframe.tsx", other: "x" }',
    'export default ({ entryFile: "presentation.unframe.tsx" })',
  ])("configを実行せず拒否する: %s", async (config) => {
    const directory = await project();
    await writeFile(join(directory, "unframe.config.ts"), config, "utf8");
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: false,
      code: "cli-config-invalid",
    });
  });

  it("symlinkとroot外entryをfail closedする", async () => {
    const directory = await project();
    await symlink(join(directory, "presentation.unframe.tsx"), join(directory, "linked.tsx"));
    await writeFile(
      join(directory, "unframe.config.ts"),
      'export default { entryFile: "linked.tsx" }',
      "utf8",
    );
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: false,
      code: "cli-project-discovery-invalid-entry-file",
    });
  });

  it.each(["../outside.tsx", "nested\\entry.tsx", "/absolute.tsx", "nested/../entry.tsx"])(
    "root-relative POSIX entryだけを許可する: %s",
    async (entryFile) => {
      const directory = await project();
      await writeFile(
        join(directory, "unframe.config.ts"),
        `export default { entryFile: ${JSON.stringify(entryFile)} }`,
        "utf8",
      );
      await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
        ok: false,
        code: "cli-project-discovery-invalid-entry-file",
      });
    },
  );

  it("BOMとinvalid UTF-8を拒否する", async () => {
    const directory = await project();
    await writeFile(
      join(directory, "unframe.config.ts"),
      '\ufeffexport default { entryFile: "presentation.unframe.tsx" }',
      "utf8",
    );
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: false,
      code: "cli-config-invalid",
    });
    await writeFile(join(directory, "unframe.config.ts"), Buffer.from([0xed, 0xa0, 0x80]));
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: false,
      code: "cli-config-invalid",
    });
  });

  it("TypeScript escapeで作られたlone surrogateを拒否する", async () => {
    const directory = await project();
    await writeFile(
      join(directory, "unframe.config.ts"),
      'export default { entryFile: "\\ud800.unframe.tsx" }',
      "utf8",
    );
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: false,
      code: "cli-config-invalid",
    });
  });

  it("正当な U+FFFD を拒否しない", async () => {
    const directory = await project();
    await writeFile(join(directory, "presentation�.unframe.tsx"), "export default {}", "utf8");
    await writeFile(
      join(directory, "unframe.config.ts"),
      'export default { entryFile: "presentation�.unframe.tsx" }',
      "utf8",
    );
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: true,
      entryFile: "presentation�.unframe.tsx",
    });
  });

  it("non-BMP文字とfoo..barを含む正当なentry filenameを許可する", async () => {
    const directory = await project();
    const entryFile = "slides/😀foo..bar.unframe.tsx";
    await mkdir(join(directory, "slides"));
    await writeFile(join(directory, entryFile), "export default {}", "utf8");
    await writeFile(
      join(directory, "unframe.config.ts"),
      `export default { entryFile: ${JSON.stringify(entryFile)} }`,
      "utf8",
    );
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: true,
      entryFile,
    });
  });

  it("entryのnested parent symlinkを拒否する", async () => {
    const directory = await project();
    const assets = join(directory, "assets");
    await mkdir(assets);
    await writeFile(join(assets, "slide.tsx"), "export default {}", "utf8");
    await symlink(assets, join(directory, "linked-assets"));
    await writeFile(
      join(directory, "unframe.config.ts"),
      'export default { entryFile: "linked-assets/slide.tsx" }',
      "utf8",
    );
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: false,
      code: "cli-project-discovery-invalid-entry-file",
    });
  });

  it("explicit absolute root 以外・symlink root/config/lockを拒否する", async () => {
    const directory = await project();
    await expect(discoverPresentationProjectFiles("relative-project")).resolves.toMatchObject({
      ok: false,
      code: "cli-project-discovery-invalid-directory",
    });
    const linkedRoot = `${directory}-link`;
    await symlink(directory, linkedRoot);
    links.push(linkedRoot);
    await expect(discoverPresentationProjectFiles(linkedRoot)).resolves.toMatchObject({
      ok: false,
      code: "cli-project-discovery-invalid-directory",
    });
    const linkedParent = `${directory}-tmp-link`;
    await symlink(tmpdir(), linkedParent);
    links.push(linkedParent);
    await expect(
      discoverPresentationProjectFiles(join(linkedParent, basename(directory))),
    ).resolves.toMatchObject({
      ok: false,
      code: "cli-project-discovery-invalid-directory",
    });

    const configTarget = join(directory, "config-target.ts");
    await writeFile(
      configTarget,
      'export default { entryFile: "presentation.unframe.tsx" }',
      "utf8",
    );
    await unlink(join(directory, "unframe.config.ts"));
    await symlink(configTarget, join(directory, "unframe.config.ts"));
    await expect(discoverPresentationProjectFiles(directory)).resolves.toMatchObject({
      ok: false,
      code: "cli-project-discovery-missing-files",
    });
  });

  it("failure diagnosticにhost pathやerror textを含めない", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unframe-project-"));
    directories.push(directory);
    await expect(discoverPresentationProjectFiles(directory)).resolves.toEqual({
      ok: false,
      code: "cli-project-discovery-missing-files",
      message: "Project root must contain regular unframe.config.ts and unframe.lock files.",
    });
  });
});
