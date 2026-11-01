import { cp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, expect, it } from "vitest";
import { runPresentationCli } from "../src/index.js";
import { createAuthorService } from "../src/author/service.js";
import type { AuthorService } from "@unframe/author-service";
import { createWebglCaptureProject } from "./local-editor-webgl-fixture.js";

const repository = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary: string[] = [];
const services: AuthorService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it.each([
  ["simple", "component", "Hero.component.tsx", 9],
  ["simple", "helper", "helper.ts", 2],
  ["extended", "component", "Hero.component.tsx", 11],
  ["extended", "helper", "helper.ts", 2],
] as const)(
  "reports the original %s %s failure location through Author build",
  async (variant, kind, fileName, line) => {
    const extended = variant === "extended";
    const directory = await createProject(extended);
    const componentSource = `import {defineComponent, editableText, prop} from "@unframe/authoring";
${extended ? 'import {Button} from "@base-ui/react/button";\nimport "./hero.css";\n' : ""}${kind === "helper" ? 'import {explode} from "./helper";\n' : ""}export const Hero = defineComponent({
  id: "hero", version: 1,
  props: {title: editableText({required: true})},
  surface: {logicalSize: [800, 450]},
  semantics: {rootNodeIds: ["title"], nodes: {
    title: {role: "heading", level: 1, parentId: null, order: 0, text: prop("title")}
  }},
  render: ({texts, bindings}: {texts: {title: string}; bindings: {title: {"data-unframe-binding": string}}}) => ${kind === "helper" ? "explode(texts.title)" : "{ throw new Error(texts.title); }"},
});`;
    await writeFile(join(directory, "Hero.component.tsx"), componentSource);
    const helperSource =
      'export const explode = (_value: string): never => {\n  throw new Error("private helper content");\n};';
    if (kind === "helper") await writeFile(join(directory, "helper.ts"), helperSource);
    const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const service = await createAuthorService(directory);
    services.push(service);
    const snapshot = await service.project();
    expect(snapshot.irHash, JSON.stringify(snapshot.diagnostics)).not.toBeNull();
    const queued = await service.build(snapshot.revision, "a".repeat(32));
    let job = await service.job(queued.buildId);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && (job.status === "queued" || job.status === "running")) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = await service.job(queued.buildId);
    }
    expect(job.status, JSON.stringify(job.diagnostics)).toBe("failed");
    expect(job.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "renderer",
          code: "opaque-render-failed",
          location: expect.objectContaining({ fileName, line }),
        }),
      ]),
    );
    const location = job.diagnostics.find((item) => item.code === "opaque-render-failed")?.location;
    assert(location);
    const original = kind === "helper" ? helperSource : componentSource;
    const before = original.slice(0, location.start).split("\n");
    expect(location.start).toBeGreaterThanOrEqual(0);
    expect(location.end).toBe(location.start + 1);
    expect(location.line).toBe(before.length);
    expect(location.column).toBe(before.at(-1)!.length + 1);
    expect(JSON.stringify(job.diagnostics)).not.toContain("private helper content");
  },
  120_000,
);

const createProject = async (extended: boolean) => {
  const directory = await createWebglCaptureProject("opaque", extended);
  temporary.push(directory);
  if (extended) {
    await writeFile(
      join(directory, "hero.css"),
      `@font-face { font-family: Fixture; src: url("fixture.ttf") format("truetype"); }
.hero { width: 800px; height: 450px; font-family: Fixture; background: #fff url("fixture.png") no-repeat right bottom; }`,
    );
    await cp(join(repository, "assets/icon.png"), join(directory, "fixture.png"));
  }
  return directory;
};
