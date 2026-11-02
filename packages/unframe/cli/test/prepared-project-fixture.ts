import { gunzip } from "node:zlib";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadUnframeLock } from "@unframe/workspace";

const decompress = promisify(gunzip);
const fixture = fileURLToPath(new URL("./fixtures/pack-project/", import.meta.url));
const lock = fileURLToPath(new URL("./fixtures/pack-project.lock.gz", import.meta.url));

export const prepareProjectFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-prepared-fixture-"));
  try {
    await cp(fixture, directory, { recursive: true });
    const bytes = await decompress(await readFile(lock));
    const parsed = loadUnframeLock(bytes);
    if (!parsed.ok) throw new Error(`Invalid prepared project lock: ${parsed.diagnostic.code}`);
    await writeFile(join(directory, "unframe.lock"), bytes);
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};
