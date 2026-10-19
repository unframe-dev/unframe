#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
project="$root/.unframe/media-video-spike/project"
mkdir -p "$project/Assets" "$project/Packages" "$project/ProjectSettings"
cp -R "$root/scripts/experiments/media-video/unity/." "$project/Assets/"
cp "$root/app/unity/ProjectSettings/ProjectVersion.txt" "$project/ProjectSettings/"
cat > "$project/Packages/manifest.json" <<'JSON'
{"dependencies":{"com.unity.modules.jsonserialize":"1.0.0","com.unity.modules.video":"1.0.0","com.unity.modules.audio":"1.0.0","com.unity.modules.imgui":"1.0.0","com.unity.modules.imageconversion":"1.0.0"}}
JSON
exec nix run "$root#unity-editor" -- -batchmode -nographics -quit -projectPath "$project" -buildTarget WebGL -executeMethod VideoSpikeBuild.Build -logFile "$root/.unframe/media-video-spike/build.log"
