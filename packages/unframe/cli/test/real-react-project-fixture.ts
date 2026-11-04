import { rm } from "node:fs/promises";
import { join } from "node:path";
import { prepareProjectFixture } from "./prepared-project-fixture.js";
import { installFixtureGraph, readFixtureGraph } from "./installed-project-fixture.js";
export const prepareRealReactProjectFixture = async () => {
  const directory = await prepareProjectFixture();
  try {
    await rm(join(directory, "node_modules"), { recursive: true, force: true });
    await installFixtureGraph(
      directory,
      await readFixtureGraph(new URL("./fixtures/react-graph.json.gz", import.meta.url)),
    );
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};
