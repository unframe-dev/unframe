import { createHash } from "node:crypto";
import { refreshProjectLock } from "@unframe/workspace";
import { expect, it } from "vitest";
import { prepareAuthorSave, saveAuthorPatch } from "../src/index.js";
import type { PatchRequest } from "@unframe/contracts/author-http";

const hashFor = (revision: string) =>
  createHash("sha256").update(JSON.stringify({ revision, request })).digest("hex");
const request: PatchRequest = {
  commandId: "id",
  expectedIrHash: "i",
  command: { kind: "setProp", instanceId: "hero", propId: "title", value: "new" },
};

it("returns an existing receipt without preparing or committing a patch", async () => {
  const saved = { revision: "r", sourceHash: "s", irHash: "i", commandId: "id" };
  const result = await saveAuthorPatch("r", request, {
    readReceipt: async () => ({ requestHash: hashFor("r"), saved }),
    readCurrent: async () => {
      throw new Error("unexpected read");
    },
    prepare: async () => {
      throw new Error("unexpected prepare");
    },
    currentRevision: async () => {
      throw new Error("unexpected discovery");
    },
    commit: async () => {
      throw new Error("unexpected commit");
    },
  });
  expect(result).toEqual(saved);
});

it("rejects a changed source revision before committing the prepared patch", async () => {
  let committed = false;
  await expect(
    saveAuthorPatch("old", request, {
      readReceipt: async () => undefined,
      readCurrent: async () => ({ snapshot: { revision: "old" } }),
      prepare: async () => "prepared",
      currentRevision: async () => "new",
      commit: async () => {
        committed = true;
        throw new Error("unexpected commit");
      },
    }),
  ).rejects.toMatchObject({ status: 412, code: "author-revision-mismatch" });
  expect(committed).toBe(false);
});

it("refreshes component and theme inputs through the workspace lock contract", () => {
  const bytes = refreshProjectLock(
    {
      rootDependencies: [],
      packages: [],
      resolutionProfile: "browser-import-production-types-v1",
      packageSnapshotProfile: "pnpm-lock9-locator-v1",
      componentLocks: [],
      themeHashes: [],
      dependencyGraphHash: "old",
    } as never,
    { componentLocks: [], themeHashes: [{ themeId: "theme", hash: "sha256:fresh" }] },
  );
  const lock = JSON.parse(new TextDecoder().decode(bytes));
  expect(lock.themeHashes).toEqual([{ themeId: "theme", hash: "sha256:fresh" }]);
  expect(lock.componentLocks).toEqual([]);
  expect(lock.dependencyGraphHash).toMatch(/^sha256:[0-9a-f]{64}$/);
});

it("prepares and commits one save only after verifying the original revision", async () => {
  const events: string[] = [];
  const saved = { revision: "next", sourceHash: "s", irHash: "i", commandId: "id" };
  const result = await saveAuthorPatch("old", request, {
    readReceipt: async () => {
      events.push("receipt");
      return undefined;
    },
    readCurrent: async () => {
      events.push("read");
      return { snapshot: { revision: "old" } };
    },
    prepare: async () => {
      events.push("prepare");
      return "prepared";
    },
    currentRevision: async () => {
      events.push("verify");
      return "old";
    },
    commit: async (_current, prepared, hash) => {
      events.push(`${prepared}:${hash}`);
      return saved;
    },
  });
  expect(result).toEqual(saved);
  expect(events).toEqual(["receipt", "read", "prepare", "verify", `prepared:${hashFor("old")}`]);
});

it("rejects a stale request before preparing Source or changing its lock", async () => {
  await expect(
    prepareAuthorSave({
      source: null,
      sourceText: "",
      entryFile: "presentation.tsx",
      snapshot: {
        revision: "current",
        sourceHash: "s",
        irHash: "i",
        definition: null,
        instances: [],
        diagnostics: [],
      },
      revision: "stale",
      request,
      lock: {} as never,
      prepareSource: async () => {
        throw new Error("unexpected prepare");
      },
      resolveAssets: async () => {
        throw new Error("unexpected assets");
      },
      revisionFor: async () => {
        throw new Error("unexpected revision");
      },
    }),
  ).rejects.toMatchObject({ status: 412, code: "author-revision-mismatch" });
});
