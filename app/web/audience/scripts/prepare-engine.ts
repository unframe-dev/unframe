import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

export async function prepareEngine(source: string, publicDirectory: string): Promise<void> {
  const distribution = join(source, "dist");
  for (const name of ["xr.js", "xr-slam.js", "LICENSE"]) await access(join(distribution, name));
  const { version } = z
    .object({ version: z.string() })
    .parse(JSON.parse(await readFile(join(source, "package.json"), "utf8")));
  const destination = join(publicDirectory, "external/xr");
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(distribution, destination, { recursive: true });
  const files: { path: string; bytes: number; sha256: string }[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        files.push({
          path: relative(destination, path).replaceAll("\\", "/"),
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  await visit(destination);
  await writeFile(
    join(publicDirectory, "external/engine-manifest.json"),
    JSON.stringify({ package: "@8thwall/engine-binary", version, files }, null, 2) + "\n",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(import.meta.url);
  const source = dirname(require.resolve("@8thwall/engine-binary/package.json"));
  await prepareEngine(source, fileURLToPath(new URL("../public", import.meta.url)));
  console.log("8th Wall配布物・LICENSE・SHA-256一覧を同一origin用に準備しました。");
}
