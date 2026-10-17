#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageLimit = 16 * 1024 * 1024;
const licenseLimit = 64 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url, limit, timeout, fetchBytes) {
  const response = await fetchBytes(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error(`download exceeds ${limit} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function extract(archive, entry, limit, ignoreCase = false) {
  // Stream only the selected member to stdout; never extract archive paths to disk.
  const reader = fileURLToPath(new URL("./read-runtime-package-entry.ps1", import.meta.url));
  return execFileSync(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      reader,
      "-Archive",
      archive,
      "-Entry",
      entry,
      "-Limit",
      String(limit),
      ...(ignoreCase ? ["-IgnoreCase"] : []),
    ],
    { maxBuffer: limit, timeout: 30_000 },
  );
}

export async function syncRuntimeDependencies(pluginRoot, mode = "check", fetchBytes = fetch) {
  if (!["check", "generate"].includes(mode)) {
    throw new Error("usage: sync-runtime-dependencies.mjs [check|generate]");
  }
  const dependencies = JSON.parse(
    await readFile(join(pluginRoot, "runtime-dependencies.json"), "utf8"),
  );
  for (const dependency of dependencies) {
    const identifier = dependency.id;
    const destination = join(pluginRoot, `${identifier}.dll`);
    const licenseDestination = join(pluginRoot, dependency.licenseFile);
    if (mode === "generate") {
      const name = identifier.toLowerCase();
      const version = dependency.version;
      const url = `https://api.nuget.org/v3-flatcontainer/${name}/${version}/${name}.${version}.nupkg`;
      const packageBytes = await download(url, packageLimit, 60_000, fetchBytes);
      if (hash(packageBytes) !== dependency.packageSha256)
        throw new Error(`${identifier}: NuGet package checksum mismatch`);
      const temporary = await mkdtemp(join(tmpdir(), "unframe-nuget-"));
      try {
        const archive = join(temporary, "package.zip");
        await writeFile(archive, packageBytes);
        const payload = extract(
          archive,
          `lib/${dependency.framework}/${identifier}.dll`,
          packageLimit,
        );
        if (hash(payload) !== dependency.sha256)
          throw new Error(`${identifier}: assembly checksum mismatch`);
        const licenseBytes = dependency.licenseUrl
          ? await download(dependency.licenseUrl, licenseLimit, 30_000, fetchBytes)
          : extract(archive, "license.txt", licenseLimit, true);
        if (hash(licenseBytes) !== dependency.licenseSha256)
          throw new Error(`${identifier}: license checksum mismatch`);
        await writeFile(destination, payload);
        await writeFile(licenseDestination, licenseBytes);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
    if (hash(await readFile(destination)) !== dependency.sha256)
      throw new Error(`${identifier}: assembly drift`);
    if (hash(await readFile(licenseDestination)) !== dependency.licenseSha256)
      throw new Error(`${identifier}: license drift`);
  }
  return dependencies.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3)
      throw new Error("usage: sync-runtime-dependencies.mjs [check|generate]");
    const pluginRoot = fileURLToPath(new URL("../Assets/Plugins/", import.meta.url));
    const count = await syncRuntimeDependencies(pluginRoot, process.argv[2]);
    console.log(`Unity managed runtime dependencies: ${count} verified`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
