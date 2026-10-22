import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const createNativeEditorConfiguration = (source: unknown, plugins: readonly string[]) => {
  const selected = z
    .object({
      dependencies: z.object({
        "com.cysharp.yetanotherhttphandler": z.string().min(1),
        "com.unity.cloud.gltfast": z.string().min(1),
        "com.unity.render-pipelines.universal": z.string().min(1),
        "com.unity.test-framework": z.string().min(1),
        "com.unity.nuget.newtonsoft-json": z.string().min(1),
      }),
    })
    .parse(source);
  return {
    manifest: {
      dependencies: {
        ...selected.dependencies,
        "com.unity.modules.jsonserialize": "1.0.0",
        "com.unity.modules.animation": "1.0.0",
        "com.unity.modules.video": "1.0.0",
        "com.unity.modules.audio": "1.0.0",
        "com.unity.modules.imageconversion": "1.0.0",
        "com.unity.modules.physics": "1.0.0",
        "com.unity.modules.xr": "1.0.0",
        "com.unity.modules.unitywebrequest": "1.0.0",
      },
    },
    tests: {
      name: "UnframeNativeTests",
      references: [
        "UnframeNativeRuntime",
        "glTFast",
        "Cysharp.Net.Http.YetAnotherHttpHandler",
        "Unity.RenderPipelines.Universal.Runtime",
        "Unity.RenderPipelines.Core.Runtime",
      ],
      includePlatforms: ["Editor"],
      optionalUnityReferences: ["TestAssemblies"],
      overrideReferences: true,
      precompiledReferences: ["nunit.framework.dll", "Newtonsoft.Json.dll", ...plugins],
    },
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [root, project] = process.argv.slice(2);
  if (!root || !project) throw new Error("Expected repository and project directories.");
  const source: unknown = JSON.parse(
    await readFile(join(root, "app/unity/Packages/manifest.json"), "utf8"),
  );
  const plugins = (await readdir(join(project, "Assets/Unframe/Plugins"))).filter((name) =>
    name.endsWith(".dll"),
  );
  const { manifest, tests } = createNativeEditorConfiguration(source, plugins);
  await writeFile(join(project, "Packages/manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(
    join(project, "Assets/Tests/Editor/UnframeNativeTests.asmdef"),
    JSON.stringify(tests, null, 2),
  );
}
