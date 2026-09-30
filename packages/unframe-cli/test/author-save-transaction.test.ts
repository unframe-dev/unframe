import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuthorTransactionConflict,
  commitAuthorPair,
  readAuthorReceipt,
  recoverAuthorTransactions,
} from "../src/author/save-transaction.js";

const roots: Array<string> = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "unframe-author-save-"));
  roots.push(root);
  await mkdir(join(root, ".unframe"));
  await writeFile(
    join(root, "unframe.config.ts"),
    'export default { entryFile: "presentation.unframe.tsx" };',
  );
  await writeFile(join(root, "presentation.unframe.tsx"), "before source");
  await writeFile(join(root, "unframe.lock"), "before lock");
  return root;
};
const commandId = "a".repeat(32);
const input = (root: string) => ({
  afterLock: new TextEncoder().encode("after lock"),
  afterSource: new TextEncoder().encode("after source"),
  beforeLock: new TextEncoder().encode("before lock"),
  beforeSource: new TextEncoder().encode("before source"),
  requestHash: "b".repeat(64),
  root,
  saved: {
    commandId,
    irHash: "sha256:ir",
    revision: "sha256:changed",
    sourceHash: "sha256:source",
  },
  sourcePath: "presentation.unframe.tsx",
});

describe("author source transaction", () => {
  it("persists the pair and a durable receipt", async () => {
    const root = await fixture();
    await commitAuthorPair(input(root));
    expect(await readFile(join(root, "presentation.unframe.tsx"), "utf8")).toBe("after source");
    expect(await readFile(join(root, "unframe.lock"), "utf8")).toBe("after lock");
    expect(await readAuthorReceipt(root, commandId)).toEqual({
      requestHash: "b".repeat(64),
      saved: input(root).saved,
    });
    await recoverAuthorTransactions(root);
    expect(await readFile(join(root, "presentation.unframe.tsx"), "utf8")).toBe("after source");
  });

  it("rolls back an interrupted applying pair and unblocks later reads", async () => {
    const root = await fixture();
    await commitAuthorPair(input(root));
    const transaction = join(root, ".unframe", "authoring", "transactions", commandId);
    await unlink(join(root, ".unframe", "authoring", "receipts", commandId + ".json"));
    const journal = JSON.parse(await readFile(join(transaction, "journal.json"), "utf8"));
    journal.state = "applying";
    await writeFile(join(transaction, "journal.json"), JSON.stringify(journal), { mode: 0o600 });
    await recoverAuthorTransactions(root);
    expect(await readFile(join(root, "presentation.unframe.tsx"), "utf8")).toBe("before source");
    expect(await readFile(join(root, "unframe.lock"), "utf8")).toBe("before lock");
    await expect(readFile(join(transaction, "journal.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves external edits instead of overwriting them during recovery", async () => {
    const root = await fixture();
    await commitAuthorPair(input(root));
    const transaction = join(root, ".unframe", "authoring", "transactions", commandId);
    await unlink(join(root, ".unframe", "authoring", "receipts", commandId + ".json"));
    const journal = JSON.parse(await readFile(join(transaction, "journal.json"), "utf8"));
    journal.state = "applying";
    await writeFile(join(transaction, "journal.json"), JSON.stringify(journal), { mode: 0o600 });
    await writeFile(join(root, "presentation.unframe.tsx"), "external edit");
    await expect(recoverAuthorTransactions(root)).rejects.toThrow("changed externally");
    expect(await readFile(join(root, "presentation.unframe.tsx"), "utf8")).toBe("external edit");
  });

  it("refuses a journal targeting a different project file", async () => {
    const root = await fixture();
    await writeFile(join(root, "other.txt"), "before source");
    await commitAuthorPair(input(root));
    const transaction = join(root, ".unframe", "authoring", "transactions", commandId);
    const journal = JSON.parse(await readFile(join(transaction, "journal.json"), "utf8"));
    journal.sourcePath = "other.txt";
    await writeFile(join(transaction, "journal.json"), JSON.stringify(journal), { mode: 0o600 });
    await expect(recoverAuthorTransactions(root)).rejects.toThrow("does not match");
    expect(await readFile(join(root, "other.txt"), "utf8")).toBe("before source");
  });

  it("reports an external edit before commit without changing either file", async () => {
    const root = await fixture();
    await writeFile(join(root, "presentation.unframe.tsx"), "external edit");
    await expect(commitAuthorPair(input(root))).rejects.toBeInstanceOf(AuthorTransactionConflict);
    expect(await readFile(join(root, "presentation.unframe.tsx"), "utf8")).toBe("external edit");
    expect(await readFile(join(root, "unframe.lock"), "utf8")).toBe("before lock");
    expect(await readdir(join(root, ".unframe", "authoring", "transactions"))).toEqual([]);
  });
});
