#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
work="$root/.unframe/media-model-spike"
project="$work/project"
mkdir -p "$project/Assets/Editor" "$project/Assets/Resources" "$project/Packages" "$project/ProjectSettings" "$work/logs"
mode="${1:-probe}"
node "$root/scripts/experiments/media-model/fixture.mjs" "$work/fixtures"
normalized="$work/fixtures/root-stripped.glb"
case "$mode" in
  compiled-probe|compiled-build)
    nix develop "$root" --command bun "$root/scripts/experiments/media-model/transform-fixture.ts" "$work/fixtures/source.glb" "$work/compiled"
    normalized="$work/compiled/model.glb"
    ;;
esac
# TextAsset keeps the runtime bytes path independent of the Editor importer.
cp "$work/fixtures/source.glb" "$project/Assets/Resources/source.bytes"
cp "$normalized" "$project/Assets/Resources/root-stripped.bytes"
cp "$root/scripts/experiments/media-model/ModelSpike.cs" "$project/Assets/"
cp "$root/scripts/experiments/media-model/ModelSpikeEditor.cs" "$project/Assets/Editor/"
cp "$root/app/unity/ProjectSettings/ProjectVersion.txt" "$project/ProjectSettings/"
cat > "$project/Packages/manifest.json" <<'JSON'
{"dependencies":{"com.unity.cloud.gltfast":"6.20.0","com.unity.render-pipelines.universal":"17.3.0","com.unity.modules.animation":"1.0.0","com.unity.modules.unitywebrequest":"1.0.0","com.unity.modules.jsonserialize":"1.0.0"}}
JSON
cp "$root/scripts/experiments/media-model/packages-lock.json" "$project/Packages/packages-lock.json"
case "$mode" in
  probe|compiled-probe) method=ModelSpikeEditor.Probe; extra=() ;;
  build|compiled-build) method=ModelSpikeEditor.Build; extra=(-quit -buildTarget WebGL) ;;
  *) echo 'Usage: run.sh [probe|build|compiled-probe|compiled-build]' >&2; exit 2 ;;
esac
exec nix run "$root#unity-editor" -- -batchmode -nographics -projectPath "$project" \
  -executeMethod "$method" "${extra[@]}" -logFile "$work/logs/$mode.log"
