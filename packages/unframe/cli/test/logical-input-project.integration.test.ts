import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, expect, it } from "vite-plus/test";
import { hashCanonicalJsonPayload, verifyBuildIntegrity } from "@unframe-dev/artifacts";
import { runPresentationCli } from "../src/index.js";
import { publishPresentation } from "../src/application/publish.js";
import { writeAuthoringBoundaryProjectFixture } from "./authoring-boundary-project-fixture.js";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";

it("builds the declared Presenter input with its action and step transition", async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-logical-input-"));
  try {
    await writeAuthoringBoundaryProjectFixture(directory);
    for (const name of ["surface.manifest.ts", "surface.structure.tsx", "theme.unframe.ts"])
      await cp(
        fileURLToPath(new URL(`./fixtures/pack-project/${name}`, import.meta.url)),
        join(directory, name),
      );
    await cp(
      fileURLToPath(
        new URL("./fixtures/logical-input-project/presentation.unframe.tsx", import.meta.url),
      ),
      join(directory, "presentation.unframe.tsx"),
    );
    const manifestPath = join(directory, "surface.manifest.ts");
    const manifestSource = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      manifestSource.replace(
        "actions: {},",
        `actions: {
      mark: { kind: "action", inputs: {}, preconditions: [], effects: [
        { kind: "setVariable", variableId: "count", value: { kind: "literal", value: 2 } },
      ] },
    },`,
      ),
    );
    const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const result = await runPresentationCli({ args: ["build", directory] });
    expect(result.exitCode, result.stderr).toBe(0);
    const artifact = async (name: string) =>
      JSON.parse(await readFile(join(directory, "dist", `${name}.json`), "utf8")) as unknown;
    const definition = await artifact("definition");
    const integrity = verifyBuildIntegrity({
      definition,
      renderBundle: await artifact("render-bundle"),
      assetSet: await artifact("asset-set"),
      buildManifest: await artifact("build-manifest"),
    });
    assert(integrity.valid, JSON.stringify(integrity.diagnostics));
    expect(integrity.value.definition.flow.groups.main?.steps.start?.cues).toContainEqual(
      expect.objectContaining({
        id: "open",
        trigger: { kind: "logicalInput", actor: { kind: "presenter" }, action: "presenter.next" },
        actions: [
          { kind: "variable.set", variableId: "count", value: { kind: "literal", value: 2 } },
        ],
        next: { kind: "step", stepId: "done" },
      }),
    );
    const fixture = JSON.parse(
      await readFile(
        new URL("./fixtures/logical-input-project/definition.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    expect(definition).toEqual(fixture);

    let publishedDefinition: unknown;
    const manifest = integrity.value.buildManifest;
    const publication = await publishPresentation({
      directory: join(directory, "dist"),
      presentationId: manifest.presentationId,
      controlPlaneUrl: "http://127.0.0.1:8787",
      bearerToken: "test-token",
      fetch: async (url, init) => {
        if (init.method === "GET") return new Response(null, { status: 404 });
        if (url.pathname === "/presentations")
          return Response.json({ id: manifest.presentationId }, { status: 201 });
        if (url.pathname.endsWith("/builds")) {
          const envelope = JSON.parse(String(init.body)) as { definitionJson: string };
          publishedDefinition = JSON.parse(envelope.definitionJson) as unknown;
          return Response.json(
            { buildId: manifest.buildId, assetIds: Object.keys(integrity.value.assetSet.assets) },
            { status: 201 },
          );
        }
        if (url.pathname.includes("/assets/")) return new Response(null, { status: 204 });
        if (url.pathname.endsWith("/publications")) {
          const receipt = { ...manifest, publicationEpoch: 1 };
          return Response.json(
            { ...receipt, publicationManifestHash: hashCanonicalJsonPayload(receipt) },
            { status: 201 },
          );
        }
        throw new Error(`Unexpected publication request: ${url.pathname}`);
      },
    });
    expect(publication).toEqual({ ok: true, buildId: manifest.buildId, publicationEpoch: 1 });
    expect(publishedDefinition).toEqual(fixture);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
