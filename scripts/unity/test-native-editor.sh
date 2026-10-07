#!/usr/bin/env bash
set -euo pipefail
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
mode="${1:-e2e}"
case "$mode" in unit|regression|e2e|showcase) ;; *) echo "Expected unit, regression, e2e or showcase." >&2; exit 1 ;; esac
project="$root/.unframe/native-editor/project"
if [[ "$mode" == regression ]]; then project="$root/.unframe/native-editor-regression/project"; fi
assets="$project/Assets"
mkdir -p "$assets" "$project/Packages" "$project/ProjectSettings" "$root/.unframe/local-editor-e2e/logs"
rm -rf "$assets/Unframe" "$assets/Tests"
mkdir -p "$assets/Unframe/Scripts" "$assets/Unframe/Plugins" "$assets/Unframe/Resources" "$assets/Tests/Editor"
runtime="$root/app/unity/Assets/Scripts/PresentationRuntime"
for directory in Animation Delivery Fixtures Generated Persistence Rendering State Transport Preview; do
  cp -R "$runtime/$directory" "$assets/Unframe/Scripts/"
done
rm -f "$assets/Unframe/Scripts/Fixtures/LocalPresentationFixtureRunner.cs" "$assets/Unframe/Scripts/Fixtures/LocalPresentationFixtureRunner.cs.meta"
cp "$runtime/PresentationBakedRuntime.cs" "$assets/Unframe/Scripts/"
find "$root/app/unity/Assets/Plugins" -maxdepth 1 -type f \( -name '*.dll' -o -name '*.dll.meta' \) -exec cp {} "$assets/Unframe/Plugins/" \;
cp "$root/app/unity/Assets/Resources/BakedSurface.shader" "$assets/Unframe/Resources/"
cp -R "$root/app/unity/Assets/Resources/PresentationFixtures" "$assets/Unframe/Resources/"
cp "$root/app/unity/Assets/Tests/LocalEditorE2E/Editor/"*.cs "$assets/Tests/Editor/"
cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationBakedRuntimeDownloadEditModeTests.cs" "$assets/Tests/Editor/"
if [[ "$mode" == regression ]]; then
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Persistence/PresentationEncodedAssetCacheEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/State/PresentationRuntimeEnvelopeEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationBakedRenderingEditModeTests.cs" "$assets/Tests/Editor/"
fi
cat > "$assets/Unframe/UnframeNativeRuntime.asmdef" <<'JSON'
{"name":"UnframeNativeRuntime","references":["Cysharp.Net.Http.YetAnotherHttpHandler"]}
JSON
python3 - "$root" "$project" "$mode" <<'PY'
import json, pathlib, sys
root, project = map(pathlib.Path, sys.argv[1:3])
mode = sys.argv[3]
source = json.loads((root / 'app/unity/Packages/manifest.json').read_text())
dependencies = {
  'com.cysharp.yetanotherhttphandler': source['dependencies']['com.cysharp.yetanotherhttphandler'],
  'com.unity.render-pipelines.universal': source['dependencies']['com.unity.render-pipelines.universal'],
  'com.unity.test-framework': source['dependencies']['com.unity.test-framework'],
  'com.unity.nuget.newtonsoft-json': source['dependencies']['com.unity.nuget.newtonsoft-json'],
  'com.unity.modules.jsonserialize': '1.0.0',
  'com.unity.modules.animation': '1.0.0',
  'com.unity.modules.imageconversion': '1.0.0',
  'com.unity.modules.physics': '1.0.0',
  'com.unity.modules.unitywebrequest': '1.0.0',
}
(project / 'Packages/manifest.json').write_text(json.dumps({'dependencies': dependencies}, indent=2))
plugins = [p.name for p in (project / 'Assets/Unframe/Plugins').glob('*.dll')]
(project / 'Assets/Tests/Editor/UnframeNativeTests.asmdef').write_text(json.dumps({
  'name': 'UnframeNativeTests', 'references': ['UnframeNativeRuntime', 'Cysharp.Net.Http.YetAnotherHttpHandler', 'Unity.RenderPipelines.Universal.Runtime', 'Unity.RenderPipelines.Core.Runtime'],
  'includePlatforms': ['Editor'], 'optionalUnityReferences': ['TestAssemblies'],
  'overrideReferences': True, 'precompiledReferences': ['nunit.framework.dll', 'Newtonsoft.Json.dll', *plugins],
}, indent=2))
PY
cp "$root/app/unity/ProjectSettings/ProjectVersion.txt" "$project/ProjectSettings/"
if [[ "$mode" == unit ]]; then
  filter='PresentationNativeHandlerFactoryEditModeTests|PresentationBakedRuntimeDownloadEditModeTests'
  graphics=(-nographics)
elif [[ "$mode" == regression ]]; then
  filter='PresentationRuntimeEnvelopeEditModeTests|PresentationNativeRecoveredSnapshotEditModeTests|PresentationBakedRenderingEditModeTests|DefaultFreeSpaceProviderAdmitsBytesOnTheActualCacheVolume|UnixFileSystemInfoMatchesThe64BitLibcAbi|VolumeMatchingUsesDirectoryBoundaries|LowSpaceReserveRejectsAdmissionWithoutPartialReservation|ASecondOwnerCannotOpenTheSameDirectoryUntilTheFirstReleasesIt|RecoveryFailureCanRetryWithoutRetainingHalfVerifiedMetadata|FailedMetadataCommitLeavesCacheNotReadyAndReturnsNoLease|PresentationNativeBootstrapCodecEditModeTests|PresentationNativeDomainReloadEditModeTests'
  graphics=(-nographics)
else
  for variable in UNFRAME_E2E_CONTROL_PLANE_ORIGIN UNFRAME_E2E_SESSION_ID UNFRAME_E2E_BEARER UNFRAME_E2E_CA_FILE UNFRAME_E2E_RESULT_PATH UNFRAME_E2E_EXPECTED_PUBLICATION_HASH UNFRAME_E2E_EXPECTED_DEFINITION_HASH UNFRAME_E2E_EXPECTED_RENDER_BUNDLE_HASH UNFRAME_E2E_EXPECTED_ASSET_SET_HASH; do
    [[ -n "${!variable:-}" ]] || { echo "Missing $variable." >&2; exit 1; }
  done
  filter='PresentationNativeServiceE2ETests'
  if [[ "$mode" == showcase ]]; then
    for variable in UNFRAME_SHOWCASE_FLOW_FILE UNFRAME_SHOWCASE_FRAME_DIRECTORY; do
      [[ -n "${!variable:-}" ]] || { echo "Missing $variable." >&2; exit 1; }
    done
    filter='PresentationNativeShowcaseVideoTests'
  fi
  graphics=(-force-glcore)
fi
exec nix run "$root#unity-editor" -- -batchmode "${graphics[@]}" -projectPath "$project" \
  -runTests -testPlatform EditMode -testFilter "$filter" \
  -testResults "$root/.unframe/local-editor-e2e/logs/$mode.xml" \
  -logFile "$root/.unframe/local-editor-e2e/logs/$mode.log"
