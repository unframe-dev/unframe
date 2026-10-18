#!/usr/bin/env bash
set -euo pipefail
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
# shellcheck source=../lib/native-host.sh
source "$root/scripts/lib/native-host.sh"
host="$(native_host)"
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
node --input-type=module - "$root" "$project" <<'JS'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [root, project] = process.argv.slice(2);
const source = JSON.parse(readFileSync(join(root, 'app/unity/Packages/manifest.json'), 'utf8'));
const dependencies = {};
for (const name of ['com.cysharp.yetanotherhttphandler', 'com.unity.render-pipelines.universal', 'com.unity.test-framework', 'com.unity.nuget.newtonsoft-json']) {
  if (!Object.hasOwn(source.dependencies, name)) throw new Error(`Missing Unity package dependency: ${name}`);
  dependencies[name] = source.dependencies[name];
}
for (const name of ['jsonserialize', 'animation', 'imageconversion', 'physics', 'unitywebrequest']) {
  dependencies[`com.unity.modules.${name}`] = '1.0.0';
}
writeFileSync(join(project, 'Packages/manifest.json'), JSON.stringify({ dependencies }, null, 2));
const plugins = readdirSync(join(project, 'Assets/Unframe/Plugins')).filter((name) => name.endsWith('.dll'));
writeFileSync(join(project, 'Assets/Tests/Editor/UnframeNativeTests.asmdef'), JSON.stringify({
  name: 'UnframeNativeTests',
  references: ['UnframeNativeRuntime', 'Cysharp.Net.Http.YetAnotherHttpHandler', 'Unity.RenderPipelines.Universal.Runtime', 'Unity.RenderPipelines.Core.Runtime'],
  includePlatforms: ['Editor'], optionalUnityReferences: ['TestAssemblies'],
  overrideReferences: true, precompiledReferences: ['nunit.framework.dll', 'Newtonsoft.Json.dll', ...plugins],
}, null, 2));
JS
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
  if [[ "$host" == linux ]]; then
    graphics=(-force-glcore)
  else
    graphics=()
  fi
fi
exec nix run "$root#unity-editor" -- -batchmode "${graphics[@]}" -projectPath "$project" \
  -runTests -testPlatform EditMode -testFilter "$filter" \
  -testResults "$root/.unframe/local-editor-e2e/logs/$mode.xml" \
  -logFile "$root/.unframe/local-editor-e2e/logs/$mode.log"
