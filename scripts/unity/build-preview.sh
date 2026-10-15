#!/usr/bin/env bash
set -euo pipefail
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
project="$root/.unframe/unity-preview/project"
assets="$project/Assets"
mkdir -p "$assets" "$project/Packages" "$project/ProjectSettings"
# Only the generated source tree is replaced; Library and build caches are reusable.
rm -rf "$assets/Unframe"
mkdir -p "$assets/Unframe/Scripts/State" "$assets/Unframe/Scripts/Delivery" "$assets/Unframe/Generated" "$assets/Unframe/Plugins" "$assets/Unframe/Resources" "$assets/Unframe/Editor"
runtime="$root/app/unity/Assets/Scripts/PresentationRuntime"
cp -R "$runtime/Rendering" "$runtime/Animation" "$runtime/Preview" "$assets/Unframe/Scripts/"
cp "$runtime/State/IPresentationRenderView.cs" "$assets/Unframe/Scripts/State/"
cp "$runtime/Delivery/PresentationDeliveryCatalog.cs" "$runtime/Delivery/PresentationBakedDeliveryValidation.cs" "$runtime/Delivery/PresentationCoordinateValidation.cs" "$assets/Unframe/Scripts/Delivery/"
for source in Runtime Delivery Realtime Preview; do
  cp "$runtime/Generated/$source.cs" "$assets/Unframe/Generated/"
done
for plugin in Google.Protobuf System.Runtime.CompilerServices.Unsafe; do
  cp "$root/app/unity/Assets/Plugins/$plugin.dll" "$root/app/unity/Assets/Plugins/$plugin.dll.meta" "$assets/Unframe/Plugins/"
done
cp -R "$root/app/unity/Assets/Plugins/WebGL" "$assets/Unframe/Plugins/"
cp "$root/app/unity/Assets/Resources/BakedSurface.shader" "$assets/Unframe/Resources/"
cp "$root/app/unity/Assets/Editor/UnframePreviewBuild.cs" "$assets/Unframe/Editor/"
cp "$root/app/unity/ProjectSettings/ProjectVersion.txt" "$project/ProjectSettings/"
cat > "$project/Packages/manifest.json" <<'JSON'
{
  "dependencies": {
    "com.unity.modules.animation": "1.0.0",
    "com.unity.modules.imageconversion": "1.0.0",
    "com.unity.modules.physics": "1.0.0",
    "com.unity.modules.ui": "1.0.0",
    "com.unity.render-pipelines.universal": "17.3.0",
    "com.unity.modules.unitywebrequest": "1.0.0"
  }
}
JSON
mkdir -p "$root/.unframe/unity-preview/logs"
exec nix run "$root#unity-editor" -- -batchmode -nographics -quit \
  -projectPath "$project" -buildTarget WebGL -executeMethod UnframePreviewBuild.Build \
  -logFile "$root/.unframe/unity-preview/logs/build.log" \
  -unframePreviewOutput "$root/.unframe/unity-preview/UnframePreview"
