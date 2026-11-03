import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prepareProjectFixture } from "./prepared-project-fixture.js";

const source = fileURLToPath(new URL("./fixtures/media-project/", import.meta.url));

export const createMediaProjectFixture = async () => {
  const directory = await prepareProjectFixture();
  try {
    await cp(source, directory, { recursive: true });
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};
