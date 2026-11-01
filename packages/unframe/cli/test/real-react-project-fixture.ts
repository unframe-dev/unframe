import { gunzip } from "node:zlib";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadUnframeLock } from "@unframe/workspace";
import { prepareProjectFixture } from "./prepared-project-fixture.js";

const decompress = promisify(gunzip);
const lock = fileURLToPath(new URL("./fixtures/react-graph.lock.gz", import.meta.url));

export const prepareRealReactProjectFixture = async () => {
  const directory = await prepareProjectFixture();
  try {
    const bytes = await decompress(await readFile(lock));
    const parsed = loadUnframeLock(bytes);
    if (!parsed.ok) throw new Error(`Invalid React graph: ${parsed.diagnostic.code}`);
    await writeFile(join(directory, "unframe.lock"), bytes);
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};
