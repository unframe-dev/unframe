import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { syncRuntimeDependencies } from "./sync-runtime-dependencies.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "unframe-runtime-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dependency = {
    id: "Test",
    version: "1.0.0",
    framework: "netstandard2.0",
    sha256: hash("assembly"),
    packageSha256: hash("package"),
    licenseFile: "LICENSE.txt",
    licenseSha256: hash("license"),
  };
  await writeFile(join(root, "runtime-dependencies.json"), JSON.stringify([dependency]));
  await writeFile(join(root, "Test.dll"), "assembly");
  await writeFile(join(root, "LICENSE.txt"), "license");
  return root;
}

test("check verifies pinned assemblies and licenses without downloading", async (t) => {
  const root = await fixture(t);
  assert.equal(
    await syncRuntimeDependencies(root, "check", () => {
      throw new Error("unexpected download");
    }),
    1,
  );
});
for (const [name, error] of [
  ["Test.dll", /assembly drift/],
  ["LICENSE.txt", /license drift/],
]) {
  test(`check rejects tampered ${name}`, async (t) => {
    const root = await fixture(t);
    await writeFile(join(root, name), "changed");
    await assert.rejects(syncRuntimeDependencies(root, "check"), error);
  });
}
test("generate checks package hash before attempting extraction or modifying files", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    syncRuntimeDependencies(root, "generate", async () => new Response("tampered zip")),
    /NuGet package checksum mismatch/,
  );
  assert.equal(await readFile(join(root, "Test.dll"), "utf8"), "assembly");
});
test("generate rejects oversized downloads", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    syncRuntimeDependencies(
      root,
      "generate",
      async () => new Response(new Uint8Array(16 * 1024 * 1024 + 1)),
    ),
    /download exceeds/,
  );
});

const packageBytes = Buffer.from(
  "UEsDBAoAAAAAAPcWUl0Z9GhXBwAAAAcAAAALABwATElDRU5TRS5UWFRVVAkAA6K202qittNqdXgLAAEE9QEAAAQAAAAAbGljZW5zZVBLAwQKAAAAAAD3FlJdAAAAAAAAAAAAAAAABAAcAGxpYi9VVAkAA6K202qittNqdXgLAAEE9QEAAAQAAAAAUEsDBAoAAAAAAPcWUl0AAAAAAAAAAAAAAAATABwAbGliL25ldHN0YW5kYXJkMi4wL1VUCQADorbTaqK202p1eAsAAQT1AQAABAAAAABQSwMECgAAAAAA9xZSXQvvCRoIAAAACAAAABsAHABsaWIvbmV0c3RhbmRhcmQyLjAvVGVzdC5kbGxVVAkAA6K202qittNqdXgLAAEE9QEAAAQAAAAAYXNzZW1ibHlQSwECHgMKAAAAAAD3FlJdGfRoVwcAAAAHAAAACwAYAAAAAAABAAAApIEAAAAATElDRU5TRS5UWFRVVAUAA6K202p1eAsAAQT1AQAABAAAAABQSwECHgMKAAAAAAD3FlJdAAAAAAAAAAAAAAAABAAYAAAAAAAAABAA7UFMAAAAbGliL1VUBQADorbTanV4CwABBPUBAAAEAAAAAFBLAQIeAwoAAAAAAPcWUl0AAAAAAAAAAAAAAAATABgAAAAAAAAAEADtQYoAAABsaWIvbmV0c3RhbmRhcmQyLjAvVVQFAAOittNqdXgLAAEE9QEAAAQAAAAAUEsBAh4DCgAAAAAA9xZSXQvvCRoIAAAACAAAABsAGAAAAAAAAQAAAKSB1wAAAGxpYi9uZXRzdGFuZGFyZDIuMC9UZXN0LmRsbFVUBQADorbTanV4CwABBPUBAAAEAAAAAFBLBQYAAAAABAAEAFUBAAA0AQAAAAA=",
  "base64",
);
for (const tamperLicense of [false, true]) {
  test(
    tamperLicense
      ? "generate rejects license hash drift before replacing the DLL"
      : "generate reproduces the selected DLL and mixed-case license entry",
    async (t) => {
      const root = await fixture(t);
      const manifest = JSON.parse(await readFile(join(root, "runtime-dependencies.json"), "utf8"));
      manifest[0].packageSha256 = hash(packageBytes);
      if (tamperLicense) manifest[0].licenseSha256 = hash("incorrect");
      await writeFile(join(root, "runtime-dependencies.json"), JSON.stringify(manifest));
      await writeFile(join(root, "Test.dll"), "original");
      if (tamperLicense) {
        await assert.rejects(
          syncRuntimeDependencies(root, "generate", async () => new Response(packageBytes)),
          /license checksum mismatch/,
        );
        assert.equal(await readFile(join(root, "Test.dll"), "utf8"), "original");
      } else {
        assert.equal(
          await syncRuntimeDependencies(root, "generate", async () => new Response(packageBytes)),
          1,
        );
        assert.equal(await readFile(join(root, "Test.dll"), "utf8"), "assembly");
        assert.equal(await readFile(join(root, "LICENSE.txt"), "utf8"), "license");
      }
    },
  );
}
