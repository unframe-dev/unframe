import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// A disposable process avoids Node, jiti and Tailwind caches across input snapshots.
// Config and plugins remain arbitrary trusted Node code; this is not an OS sandbox.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
let phase = "boundary";
try {
  const root = await realpath(request.root);
  process.chdir(root);
  const from = path.resolve(root, request.input ?? "input.css");
  if (!from.startsWith(`${root}${path.sep}`)) throw new Error("Input escapes project root");
  const requireProject = createRequire(path.join(root, "package.json"));
  const { default: loadConfig } = await import(request.loaderUrl);
  const { default: postcss } = await import(pathToFileURL(requireProject.resolve("postcss")));
  phase = "config";
  const config = await loadConfig({ cwd: root, env: process.env.NODE_ENV }, root, {
    stopDir: root,
  });
  if (!config.file.startsWith(`${root}${path.sep}`)) throw new Error("Config escapes project root");
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
    JSON.stringify({
      ok: true,
      css: result.css,
      map: result.map?.toJSON(),
      messages: result.messages,
      config: config.file,
      versions: Object.fromEntries(
        await Promise.all(
          ["postcss", "tailwindcss", "@tailwindcss/postcss"].map(async (name) => [
            name,
            JSON.parse(
              await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"),
            ).version,
          ]),
        ),
      ),
      configOptionKeys: Object.keys(config.options).sort(),
      processOptions: { from: result.opts.from, to: result.opts.to, map: result.opts.map },
      nativeLibraries: process.report
        .getReport()
        .sharedObjects.filter((file) => /oxide|lightningcss/.test(file)),
    }),
  );
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, phase, name: error.name, error: error.message }),
  );
  process.exitCode = 1;
}
