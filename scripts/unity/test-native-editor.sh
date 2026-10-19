#!/usr/bin/env bash
set -euo pipefail
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
mode="${1:-e2e}"
case "$mode" in unit|regression|playback|e2e|showcase) ;; *) echo "Expected unit, regression, playback, e2e or showcase." >&2; exit 1 ;; esac
project="$root/.unframe/native-editor/project"
if [[ "$mode" == regression ]]; then project="$root/.unframe/native-editor-regression/project"; fi
if [[ "$mode" == playback ]]; then project="$root/.unframe/native-editor-playback/project"; fi
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
mkdir -p "$assets/Unframe/Scripts/Quest"
for file in PresentationCalibrationState PresentationCalibrationMath QuestPresentationTracking; do
  cp "$runtime/Quest/$file.cs" "$assets/Unframe/Scripts/Quest/"
done
find "$root/app/unity/Assets/Plugins" -maxdepth 1 -type f \( -name '*.dll' -o -name '*.dll.meta' \) -exec cp {} "$assets/Unframe/Plugins/" \;
cp "$root/app/unity/Assets/Resources/BakedSurface.shader" "$assets/Unframe/Resources/"
cp -R "$root/app/unity/Assets/Resources/PresentationModelShaders" "$assets/Unframe/Resources/"
cp -R "$root/app/unity/Assets/Resources/PresentationMaterials" "$assets/Unframe/Resources/"
cp -R "$root/app/unity/Assets/Resources/PresentationFixtures" "$assets/Unframe/Resources/"
cp "$root/app/unity/Assets/Tests/LocalEditorE2E/Editor/"*.cs "$assets/Tests/Editor/"
cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationBakedRuntimeDownloadEditModeTests.cs" "$assets/Tests/Editor/"
if [[ "$mode" == regression ]]; then
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Persistence/PresentationEncodedAssetCacheEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/State/PresentationRuntimeEnvelopeEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationBakedRenderingEditModeTests.cs" "$assets/Tests/Editor/"
fi
cat > "$assets/Unframe/UnframeNativeRuntime.asmdef" <<'JSON'
{"name":"UnframeNativeRuntime","references":["Cysharp.Net.Http.YetAnotherHttpHandler","glTFast"]}
JSON
bun "$root/scripts/unity/prepare-native-editor.ts" "$root" "$project"
cp "$root/app/unity/ProjectSettings/ProjectVersion.txt" "$project/ProjectSettings/"
if [[ "$mode" == playback ]]; then
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationPreviewTestFixture.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationPreviewPlaybackEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationPreviewTransactionEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/UnframePreviewBridgeEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Transport/PresentationControlPlaneConnectionEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationTextureResidencyEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationVideoLifecycleEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationModelRuntimeEditModeTests.cs" "$assets/Tests/Editor/"
  cp "$root/app/unity/Assets/Tests/EditMode/Editor/Rendering/PresentationBakedRenderingEditModeTests.cs" "$assets/Tests/Editor/"
  filter='PresentationBakedRuntimeDownloadEditModeTests|PresentationBakedRenderingEditModeTests|PresentationTextureResidencyEditModeTests|PresentationVideoLifecycleEditModeTests|PresentationControlPlaneConnectionEditModeTests|PresentationModelRuntimeEditModeTests|PresentationPreviewPlaybackEditModeTests|PresentationPreviewTransactionEditModeTests|UnframePreviewBridgeEditModeTests'
  graphics=(-nographics)
elif [[ "$mode" == unit ]]; then
  filter='PresentationNativeRuntimeFixtureEditModeTests|PresentationNativeHandlerFactoryEditModeTests|PresentationBakedRuntimeDownloadEditModeTests'
  graphics=(-nographics)
elif [[ "$mode" == regression ]]; then
  filter='PresentationNativeRuntimeFixtureEditModeTests|PresentationRuntimeEnvelopeEditModeTests|PresentationNativeRecoveredSnapshotEditModeTests|PresentationBakedRenderingEditModeTests|DefaultFreeSpaceProviderAdmitsBytesOnTheActualCacheVolume|UnixFileSystemInfoMatchesThe64BitLibcAbi|VolumeMatchingUsesDirectoryBoundaries|LowSpaceReserveRejectsAdmissionWithoutPartialReservation|ASecondOwnerCannotOpenTheSameDirectoryUntilTheFirstReleasesIt|RecoveryFailureCanRetryWithoutRetainingHalfVerifiedMetadata|FailedMetadataCommitLeavesCacheNotReadyAndReturnsNoLease|PresentationNativeBootstrapCodecEditModeTests|PresentationNativeDomainReloadEditModeTests'
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
