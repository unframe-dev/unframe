import { dirname, join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import * as ts from "typescript";
import {
  prepareProjectSource as prepareBuildSource,
  type StylePreparationPort,
} from "@unframe/build";
import type { UnframeLock } from "@unframe/workspace";
import type { DiscoveredProjectFiles } from "./discover-project.js";

type Discovery = Extract<DiscoveredProjectFiles, { ok: true }>;
export const prepareProjectSource = async (
  styles: StylePreparationPort,
  found: Discovery,
  graph: Pick<
    UnframeLock,
    "rootDependencies" | "packages" | "styleTransform" | "styleSourceIdentity"
  >,
  options: { update?: boolean; refresh?: boolean; signal?: AbortSignal; replacement?: string } = {},
) => {
  const typeLibraries = await readTypeLibraries();
  return prepareBuildSource(found, graph, options, { typeLibraries, styles });
};

export const readTypeLibraries = async () => {
  const libraryDirectory = dirname(ts.getDefaultLibFilePath({}));
  const typeLibraries = await Promise.all(
    (await readdir(libraryDirectory))
      .filter((name) => /^lib(?:\.[a-z0-9.]+)?\.d\.ts$/u.test(name))
      .sort()
      .map(async (fileName) => ({
        fileName,
        sourceText: await readFile(join(libraryDirectory, fileName), "utf8"),
      })),
  );
  return typeLibraries;
};
