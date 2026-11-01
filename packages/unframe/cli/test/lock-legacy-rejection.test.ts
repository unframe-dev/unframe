import { sourceAssetPorts } from "../src/application/media-ports.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { updateProjectLock } from "@unframe/workspace-node";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";

it("rejects a lock without renderer pins without silently migrating it", async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-old-lock-"));
  try {
    await writeFile(
      join(directory, "unframe.config.ts"),
      'export default { entryFile: "presentation.unframe.tsx", assets: {} };',
    );
    await writeFile(join(directory, "presentation.unframe.tsx"), "export default {};");
    await writeFile(join(directory, "unframe.lock"), "{}\n");
    await expect(
      updateProjectLock(sourceAssetPorts, directory, "refresh", false),
    ).resolves.toMatchObject({
      ok: false,
      code: "cli-lock-renderer-plugins-refresh-required",
    });
    expect(await readFile(join(directory, "unframe.lock"), "utf8")).toBe("{}\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
