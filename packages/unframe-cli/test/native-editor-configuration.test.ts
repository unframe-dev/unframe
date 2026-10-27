import { describe, expect, it } from "vitest";
import { createNativeEditorConfiguration } from "../../../scripts/unity/prepare-native-editor.js";

const dependencies = {
  "com.cysharp.yetanotherhttphandler": "handler-version",
  "com.unity.cloud.gltfast": "model-version",
  "com.unity.render-pipelines.universal": "pipeline-version",
  "com.unity.test-framework": "test-version",
  "com.unity.nuget.newtonsoft-json": "json-version",
  "com.unity.ugui": "ui-version",
  "com.unity.inputsystem": "input-version",
  "unused-package": "unused-version",
};

describe("native Unity test configuration", () => {
  it("selects the original dependencies and fixed Unity modules", () => {
    expect(createNativeEditorConfiguration({ dependencies }, []).manifest).toEqual({
      dependencies: {
        "com.cysharp.yetanotherhttphandler": "handler-version",
        "com.unity.cloud.gltfast": "model-version",
        "com.unity.render-pipelines.universal": "pipeline-version",
        "com.unity.test-framework": "test-version",
        "com.unity.nuget.newtonsoft-json": "json-version",
        "com.unity.ugui": "ui-version",
        "com.unity.inputsystem": "input-version",
        "com.unity.modules.jsonserialize": "1.0.0",
        "com.unity.modules.animation": "1.0.0",
        "com.unity.modules.video": "1.0.0",
        "com.unity.modules.audio": "1.0.0",
        "com.unity.modules.imageconversion": "1.0.0",
        "com.unity.modules.physics": "1.0.0",
        "com.unity.modules.xr": "1.0.0",
        "com.unity.modules.unitywebrequest": "1.0.0",
      },
    });
  });
  it("preserves runtime, render pipeline, test assembly and DLL references", () => {
    expect(
      createNativeEditorConfiguration({ dependencies }, ["Transport.dll", "Wire.dll"]).tests,
    ).toEqual({
      name: "UnframeNativeTests",
      references: [
        "UnframeNativeRuntime",
        "glTFast",
        "Cysharp.Net.Http.YetAnotherHttpHandler",
        "Unity.RenderPipelines.Universal.Runtime",
        "Unity.RenderPipelines.Core.Runtime",
        "Unity.ugui",
        "Unity.TextMeshPro",
      ],
      includePlatforms: ["Editor"],
      optionalUnityReferences: ["TestAssemblies"],
      overrideReferences: true,
      precompiledReferences: [
        "nunit.framework.dll",
        "Newtonsoft.Json.dll",
        "Transport.dll",
        "Wire.dll",
      ],
    });
  });
  it("rejects a missing source dependency", () => {
    expect(() => createNativeEditorConfiguration({ dependencies: {} }, [])).toThrow();
  });
});
