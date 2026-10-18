import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { projectDirectory } from "../src/filesystem/path-policy.js";

const selection = vi.hoisted(() => ({ root: undefined as string | undefined }));
vi.mock("node:os", async (original) => {
  const actual = await original<typeof import("node:os")>();
  return { ...actual, tmpdir: () => selection.root ?? actual.tmpdir() };
});

it("canonicalizes the runtime temporary base while retaining project symlink rejection", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-temp-base-"));
  try {
    const actual = join(root, "actual");
    const alias = join(root, "alias");
    await mkdir(actual);
    await symlink(actual, alias);
    selection.root = alias;
    expect(temporaryDirectory()).toBe(actual);
    const project = await mkdtemp(join(temporaryDirectory(), "project-"));
    expect(await projectDirectory(project)).toBe(project);
    await symlink(project, join(actual, "linked-project"));
    expect(await projectDirectory(join(actual, "linked-project"))).toBeUndefined();
  } finally {
    selection.root = undefined;
    await rm(root, { recursive: true, force: true });
  }
});
