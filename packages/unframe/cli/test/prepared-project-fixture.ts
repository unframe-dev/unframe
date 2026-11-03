import { cp, mkdtemp, rm } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installFixtureGraph, readFixtureGraph } from "./installed-project-fixture.js";

const fixture = fileURLToPath(new URL("./fixtures/pack-project/", import.meta.url));
export const prepareProjectFixture = async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-prepared-fixture-"));
  try {
    await cp(fixture, directory, { recursive: true });
    await installFixtureGraph(
      directory,
      await readFixtureGraph(new URL("./fixtures/pack-project-graph.json.gz", import.meta.url)),
    );
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};
