import { expect, it, vi } from "vitest";
import { prepareLockUpdate, prepareLockRefresh } from "../src/index.js";
import { createProjectLock } from "@unframe/workspace";

const found = {
  projectDirectory: "/project",
  entryFile: "main.ts",
  files: [],
  localFiles: [],
  assetSources: {},
  lockBytes: new TextEncoder().encode("invalid"),
};
const ports = () => ({
  readTypeLibraries: vi.fn().mockResolvedValue([]),
  styles: { snapshot: vi.fn(), withSources: vi.fn(), compile: vi.fn() },
  modelTransformIdentity: "sha256:model" as const,
  videoTransformIdentity: vi.fn(),
  install: vi.fn(),
  snapshotInstalledPackages: vi.fn(),
});
it("rejects an invalid lock before requesting environment operations", async () => {
  const adapter = ports();
  expect((await prepareLockRefresh({ found }, adapter)).ok).toBe(false);
  expect(adapter.install).not.toHaveBeenCalled();
  expect(adapter.snapshotInstalledPackages).not.toHaveBeenCalled();
});
it("preserves an install failure before snapshot", async () => {
  const adapter = ports();
  adapter.install.mockResolvedValue({ ok: false, code: "missing", message: "missing inputs" });
  expect(await prepareLockUpdate({ found, operation: "update", recreate: true }, adapter)).toEqual({
    ok: false,
    code: "missing",
    message: "missing inputs",
  });
  expect(adapter.snapshotInstalledPackages).not.toHaveBeenCalled();
});
it("does not perform environment work after cancellation", async () => {
  const adapter = ports();
  expect(
    await prepareLockUpdate(
      { found, operation: "update", recreate: true, signal: AbortSignal.abort() },
      adapter,
    ),
  ).toMatchObject({ ok: false, code: "cli-cancelled" });
  expect(adapter.install).not.toHaveBeenCalled();
});
it("reports cancellation when install rejects after abort", async () => {
  const controller = new AbortController();
  const adapter = ports();
  adapter.install.mockImplementation(async () => {
    controller.abort();
    throw new DOMException("aborted", "AbortError");
  });
  expect(
    await prepareLockUpdate(
      { found, operation: "update", recreate: true, signal: controller.signal },
      adapter,
    ),
  ).toMatchObject({ ok: false, code: "cli-cancelled" });
});
it("reports cancellation when video identity rejects during refresh", async () => {
  const controller = new AbortController();
  const adapter = ports();
  adapter.videoTransformIdentity.mockImplementation(async () => {
    controller.abort();
    throw new DOMException("aborted", "AbortError");
  });
  const lockBytes = createProjectLock(
    { packageManagerLockHash: `sha256:${"0".repeat(64)}`, rootDependencies: [], packages: [] },
    { componentLocks: [], themeHashes: [], assets: [] },
  );
  const video = {
    ...found,
    lockBytes,
    assetSources: { video: { path: "video.mp4", mediaType: "video/mp4" as const } },
  };
  expect(
    await prepareLockRefresh({ found: video, signal: controller.signal }, adapter),
  ).toMatchObject({ ok: false, code: "cli-cancelled" });
});
it("installs before snapshotting, then checks the captured source", async () => {
  const adapter = ports();
  const calls: string[] = [];
  adapter.install.mockImplementation(async () => {
    calls.push("install");
    return { ok: true };
  });
  adapter.snapshotInstalledPackages.mockImplementation(async () => {
    calls.push("snapshot");
    return { packageManagerLockHash: "sha256:hash", rootDependencies: [], packages: [] };
  });
  adapter.readTypeLibraries.mockImplementation(async () => {
    calls.push("libraries");
    return [];
  });
  const result = await prepareLockUpdate({ found, operation: "update", recreate: true }, adapter);
  expect(result).toMatchObject({ ok: false, code: "cli-lock-source-invalid" });
  expect(calls).toEqual(["install", "snapshot", "libraries"]);
});
it("stops after snapshot resolves if it cancelled the operation", async () => {
  const controller = new AbortController();
  const adapter = ports();
  adapter.install.mockResolvedValue({ ok: true });
  adapter.snapshotInstalledPackages.mockImplementation(async () => {
    controller.abort();
    return { packageManagerLockHash: "sha256:hash", rootDependencies: [], packages: [] };
  });
  expect(
    await prepareLockUpdate(
      { found, operation: "update", recreate: true, signal: controller.signal },
      adapter,
    ),
  ).toMatchObject({ ok: false, code: "cli-cancelled" });
  expect(adapter.readTypeLibraries).not.toHaveBeenCalled();
});
it("stops after type libraries resolve if they cancelled the operation", async () => {
  const controller = new AbortController();
  const adapter = ports();
  adapter.install.mockResolvedValue({ ok: true });
  adapter.snapshotInstalledPackages.mockResolvedValue({
    packageManagerLockHash: "sha256:hash",
    rootDependencies: [],
    packages: [],
  });
  adapter.readTypeLibraries.mockImplementation(async () => {
    controller.abort();
    return [];
  });
  expect(
    await prepareLockUpdate(
      { found, operation: "update", recreate: true, signal: controller.signal },
      adapter,
    ),
  ).toMatchObject({ ok: false, code: "cli-cancelled" });
});
