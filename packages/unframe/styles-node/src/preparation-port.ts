import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { StylePreparationPort } from "@unframe/build";
import { snapshotNodeTransformInputs, withNodeTransformSources } from "./node-snapshot.js";
import { runStyleWorker } from "./run-style-worker.js";
import { compileStylesResultSchema } from "./schemas.js";

export const createNodeStylePreparationPort = (): StylePreparationPort => ({
  snapshot: (projectRoot, sourceFiles) =>
    snapshotNodeTransformInputs(projectRoot, {
      sourceFiles,
      adapterRoot: dirname(
        dirname(fileURLToPath(import.meta.resolve("@unframe/styles-node/compiler"))),
      ),
      adapterSubpath: "./compiler",
      adapterDependencySnapshot: "dist/adapter-dependencies.json.gz",
    }),
  withSources: withNodeTransformSources,
  compile: async (snapshot, entries, signal) =>
    compileStylesResultSchema.parse(
      await runStyleWorker(snapshot, { entries, ...(signal ? { signal } : {}) }),
    ),
});
