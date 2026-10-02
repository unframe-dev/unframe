#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

project="${REPO_ROOT}/app/unity-preview"
version="$(sed -n 's/^m_EditorVersion: //p' "${project}/ProjectSettings/ProjectVersion.txt")"
if [[ -z "${UNITY_EDITOR:-}" ]]; then
  case "$(uname -s)" in
    Linux) UNITY_EDITOR="${HOME}/Unity/Hub/Editor/${version}/Editor/Unity" ;;
    Darwin) UNITY_EDITOR="/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity" ;;
    *) printf 'Set UNITY_EDITOR to the Unity %s executable.\n' "${version}" >&2; exit 1 ;;
  esac
fi
if [[ ! -x "${UNITY_EDITOR}" ]]; then
  printf 'Unity %s was not found at %s. Install it with Web Build Support or set UNITY_EDITOR.\n' "${version}" "${UNITY_EDITOR}" >&2
  exit 1
fi
if [[ -f "${project}/Temp/UnityLockfile" ]]; then
  printf 'Close this project in Unity Editor before building the Web preview.\n' >&2
  exit 1
fi

unity_command=("${UNITY_EDITOR}")
if [[ -n "${UNITY_EDITOR_RUNNER:-}" ]]; then
  unity_command=("${UNITY_EDITOR_RUNNER}" "${unity_command[@]}")
fi

# Unity may serialize Editor defaults while switching the build target.
settings=(
  "ProjectSettings/ProjectSettings.asset"
  "ProjectSettings/UnityConnectSettings.asset"
)
snapshot="$(mktemp -d)"
for index in "${!settings[@]}"; do
  cp "${project}/${settings[index]}" "${snapshot}/${index}"
done
restore_settings() {
  for index in "${!settings[@]}"; do
    cp "${snapshot}/${index}" "${project}/${settings[index]}"
  done
  rm -r "${snapshot}"
}
trap restore_settings EXIT

mkdir -p "${project}/Logs"
log "Building Unity ${version} Web preview (log: app/unity-preview/Logs/web-preview-build.log)"
"${unity_command[@]}" -batchmode -quit -nographics \
  -projectPath "${project}" -buildTarget WebGL \
  -executeMethod UnframeWebPreviewBuild.Build \
  -logFile "${project}/Logs/web-preview-build.log"
