import { mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireSourceLock, recoverAuthorTransactions } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "unframe-source-lease-"));
  roots.push(root);
  await writeFile(join(root, "unframe.config.ts"), 'export default { entryFile: "source.tsx" };');
  const lease = await acquireSourceLock(root, { allowRecovery: true });
  if (!lease.ok) throw new Error("Fixture lease failed");
  return { root, lease: lease.value };
};

it("rejects a new scope as soon as release starts", async () => {
  const { lease } = await fixture();
  const releasing = lease.release();
  try {
    await expect(lease.run(async () => "new operation")).rejects.toThrow("released");
  } finally {
    await releasing;
  }
});

it("rejects a transaction in an existing scope after release starts", async () => {
  const { root, lease } = await fixture();
  await lease.run(async () => {
    const releasing = lease.release();
    try {
      await expect(recoverAuthorTransactions(root)).rejects.toThrow("unavailable");
    } finally {
      await releasing;
    }
  });
});

it("keeps a failed release closed to operations and permits cleanup retry", async () => {
  const { root, lease } = await fixture();
  const path = join(root, ".unframe-source.lock");
  const displaced = join(root, "owned-lease");
  await rename(path, displaced);
  await writeFile(path, "another owner");
  await expect(lease.release()).rejects.toThrow("release failed");
  await expect(lease.run(async () => "new operation")).rejects.toThrow("released");
  expect(await readFile(path, "utf8")).toBe("another owner");
  await unlink(path);
  await rename(displaced, path);
  await lease.release();
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("shares concurrent cleanup without reopening the lease", async () => {
  const { root, lease } = await fixture();
  await Promise.all([lease.release(), lease.release()]);
  await expect(readFile(join(root, ".unframe-source.lock"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(lease.run(async () => "new operation")).rejects.toThrow("released");
});
