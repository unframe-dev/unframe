#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import yauzl, { type Entry, type ZipFile } from "yauzl";
import type { Readable } from "node:stream";
import { z } from "zod";

const segment = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const dependenciesSchema = z
  .array(
    z.strictObject({
      id: segment,
      version: segment,
      framework: segment,
      sha256: z.hash("sha256"),
      packageSha256: z.hash("sha256"),
      licenseFile: segment,
      licenseSha256: z.hash("sha256"),
      licenseUrl: z.url({ protocol: /^https$/ }).optional(),
    }),
  )
  .min(1);
const modeSchema = z.enum(["check", "generate"]);

const packageLimit = 16 * 1024 * 1024;
const licenseLimit = 64 * 1024;
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function download(url: string, limit: number, timeout: number, fetchBytes: typeof fetch) {
  const response = await fetchBytes(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  if (!response.body) throw new Error(`${url}: missing response body`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error(`download exceeds ${limit} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function readPackageEntry(
  archive: Buffer,
  name: string,
  limit: number,
  ignoreCase = false,
  timeout = 30_000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let zip: ZipFile | undefined;
    let stream: Readable | undefined;
    let settled = false;
    const finish = (error?: Error, bytes?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream?.destroy();
      zip?.close();
      if (error) reject(error);
      else resolve(bytes!);
    };
    const timer = setTimeout(
      () => finish(new Error("Package entry extraction timed out")),
      timeout,
    );
    yauzl.fromBuffer(
      archive,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, opened) => {
        if (settled) {
          opened?.close();
          return;
        }
        if (error) return finish(error);
        zip = opened;
        zip.on("error", finish);
        zip.on("end", () => finish(new Error(`Package entry missing: ${name}`)));
        zip.on("entry", (entry: Entry) => {
          const matches = ignoreCase
            ? entry.fileName.toLowerCase() === name.toLowerCase()
            : entry.fileName === name;
          if (!matches) {
            zip!.readEntry();
            return;
          }
          if (entry.uncompressedSize > limit)
            return finish(new Error(`Package entry exceeds ${limit} bytes`));
          zip!.openReadStream(entry, (error, openedStream) => {
            if (settled) {
              openedStream?.destroy();
              return;
            }
            if (error) return finish(error);
            stream = openedStream;
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("error", finish);
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > limit) return finish(new Error(`Package entry exceeds ${limit} bytes`));
              chunks.push(chunk);
            });
            stream.on("end", () => finish(undefined, Buffer.concat(chunks)));
          });
        });
        zip.readEntry();
      },
    );
  });
}

export async function syncRuntimeDependencies(
  pluginRoot: string,
  mode: string = "check",
  fetchBytes: typeof fetch = fetch,
) {
  modeSchema.parse(mode);
  const dependencies = dependenciesSchema.parse(
    JSON.parse(await readFile(join(pluginRoot, "runtime-dependencies.json"), "utf8")),
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
      const payload = await readPackageEntry(
        packageBytes,
        `lib/${dependency.framework}/${identifier}.dll`,
        packageLimit,
      );
      if (hash(payload) !== dependency.sha256)
        throw new Error(`${identifier}: assembly checksum mismatch`);
      const licenseBytes = dependency.licenseUrl
        ? await download(dependency.licenseUrl, licenseLimit, 30_000, fetchBytes)
        : await readPackageEntry(packageBytes, "license.txt", licenseLimit, true);
      if (hash(licenseBytes) !== dependency.licenseSha256)
        throw new Error(`${identifier}: license checksum mismatch`);
      await writeFile(destination, payload);
      await writeFile(licenseDestination, licenseBytes);
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
      throw new Error("usage: sync-runtime-dependencies.ts [check|generate]");
    const pluginRoot = fileURLToPath(new URL("../Assets/Plugins/", import.meta.url));
    const count = await syncRuntimeDependencies(pluginRoot, process.argv[2]);
    console.log(`Unity managed runtime dependencies: ${count} verified`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
