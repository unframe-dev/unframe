import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, expect, it } from "vite-plus/test";
import { loadUnframeLock } from "@unframe-dev/workspace";
import { createAuthorService } from "../src/author/service.js";
import { clearSourceAssetRegistration } from "./source-asset-fixtures.js";
import { prepareReactProjectFixture } from "./react-project-fixture.js";

it("automatically freezes project dependencies for a new PostCSS config through the analysis worker", async () => {
  const { directory, presentation } = await prepareReactProjectFixture();
  const fixture = fileURLToPath(new URL("./fixtures/tailwind-project/", import.meta.url));
  let service: Awaited<ReturnType<typeof createAuthorService>> | undefined;
  try {
    await clearSourceAssetRegistration(directory, "presentation.unframe.tsx");
    const { theme: _theme, ...definition } = presentation;
    await writeFile(
      join(directory, "presentation.unframe.tsx"),
      `import {definePresentation} from "@unframe-dev/authoring";\nexport default definePresentation(${JSON.stringify(
        {
          ...definition,
          scene: [],
          assets: [],
          flow: {
            initialGroupId: "main",
            groups: {
              main: {
                id: "main",
                initialStepId: "first",
                steps: { first: { id: "first", cues: [] } },
              },
            },
            variables: {},
          },
        },
      )});\n`,
    );
    for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vendor"])
      await cp(join(fixture, name), join(directory, name), { recursive: true });
    await mkdir(join(directory, "dist"));
    await writeFile(join(directory, "dist/build-manifest.json"), "saved Dist\n");
    await writeFile(join(directory, "postcss.config.mjs"), "export default { plugins: [] };\n");
    await writeFile(join(directory, "theme.css"), "main { color: red; }\n");
    const before = await readFile(join(directory, "unframe.lock"));
    const packageManagerLock = await readFile(join(directory, "pnpm-lock.yaml"));
    let builds = 0;
    service = await createAuthorService(directory, {
      run: async () => {
        builds++;
        const frozen = loadUnframeLock(await readFile(join(directory, "unframe.lock")));
        assert(frozen.ok);
        expect(frozen.value.lock.styleTransform).toBeDefined();
        expect(frozen.value.lock.styleSourceIdentity).toBeDefined();
        return { exitCode: 0, stdout: "", stderr: "", generationId: "f".repeat(32) };
      },
      readPublishedArtifacts: async () => ({
        identity: "identity",
        catalog: [],
        assets: new Map(),
      }),
    });
    const initial = await service.project();
    expect(initial.irHash).toBeNull();
    const created = await service.build(initial.revision, "1".repeat(32));
    await expect.poll(async () => (await service!.job(created.buildId)).status).toBe("succeeded");
    expect(builds).toBe(1);
    expect(created.revision).not.toBe(initial.revision);
    expect((await service.project()).revision).toBe(created.revision);
    expect(await readFile(join(directory, "unframe.lock"))).not.toEqual(before);
    expect(await readFile(join(directory, "pnpm-lock.yaml"))).toEqual(packageManagerLock);
    expect((await stat(join(directory, "node_modules"))).isDirectory()).toBe(true);
    await rm(join(directory, "node_modules"), { recursive: true, force: true });
    await writeFile(join(directory, "theme.css"), "main { color: blue; }\n");
    const edited = await service.project();
    const rebuilt = await service.build(edited.revision, "2".repeat(32));
    await expect.poll(async () => (await service!.job(rebuilt.buildId)).status).toBe("succeeded");
    expect(builds).toBe(2);
    expect((await stat(join(directory, "node_modules"))).isDirectory()).toBe(true);
    expect(await readFile(join(directory, "pnpm-lock.yaml"))).toEqual(packageManagerLock);
    expect(await readFile(join(directory, "dist/build-manifest.json"), "utf8")).toBe(
      "saved Dist\n",
    );
  } finally {
    await service?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
