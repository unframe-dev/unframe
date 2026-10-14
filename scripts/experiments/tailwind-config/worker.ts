import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import isPathInside from "path-is-inside";
import type loadConfigType from "postcss-load-config";
import type postcssType from "postcss";
import {
  requestSchema,
  responseSchema,
  packageVersionSchema,
  reportSchema,
  type Response,
} from "./schemas.ts";

// A disposable process avoids Node, jiti and Tailwind caches across input snapshots.
// Config and plugins remain arbitrary trusted Node code; this is not an OS sandbox.
let input = "";
for await (const chunk of process.stdin) input += chunk;
let phase: Extract<Response, { ok: false }>["phase"] = "boundary";
try {
  const request = requestSchema.parse(JSON.parse(input));
  const root = await realpath(request.root);
  process.chdir(root);
  const from = path.resolve(root, request.input ?? "input.css");
  if (from === root || !isPathInside(from, root)) throw new Error("Input escapes project root");
  const requireProject = createRequire(path.join(root, "package.json"));
  const { default: loadConfig } = (await import(request.loaderUrl)) as {
    default: typeof loadConfigType;
  };
  const { default: postcss } = (await import(
    pathToFileURL(requireProject.resolve("postcss")).href
  )) as { default: typeof postcssType };
  phase = "config";
  const config = await loadConfig({ cwd: root, env: process.env.NODE_ENV }, root, {
    stopDir: root,
  });
  if (config.file === root || !isPathInside(config.file, root))
    throw new Error("Config escapes project root");
  phase = "transform";
  const options = request.plainOptions
    ? config.options
    : {
        ...config.options,
        from,
        to: from,
        map: { inline: false, annotation: false, sourcesContent: true },
      };
  const result = await postcss(config.plugins).process(await readFile(from, "utf8"), options);
  process.stdout.write(
    JSON.stringify(
      responseSchema.parse({
        ok: true,
        css: result.css,
        map: result.map?.toJSON(),
        messages: result.messages,
        config: config.file,
        versions: Object.fromEntries(
          await Promise.all(
            ["postcss", "tailwindcss", "@tailwindcss/postcss"].map(async (name) => [
              name,
              packageVersionSchema.parse(
                JSON.parse(
                  await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"),
                ),
              ).version,
            ]),
          ),
        ),
        configOptionKeys: Object.keys(config.options).sort(),
        processOptions: { from: result.opts.from, to: result.opts.to, map: result.opts.map },
        nativeLibraries: reportSchema
          .parse(process.report.getReport())
          .sharedObjects.filter((file) => /oxide|lightningcss/.test(file)),
      }),
    ),
  );
} catch (error) {
  const failure: Response = {
    ok: false,
    phase,
    name: error instanceof Error ? error.name : "Error",
    error: error instanceof Error ? error.message : String(error),
  };
  process.stdout.write(JSON.stringify(responseSchema.parse(failure)));
  process.exitCode = 1;
}
