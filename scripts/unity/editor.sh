#!/usr/bin/env bash
set -euo pipefail
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
# shellcheck source=../lib/native-host.sh
source "$root/scripts/lib/native-host.sh"
host="$(native_host)"
version="$(sed -n 's/^m_EditorVersion: //p' "$root/app/unity/ProjectSettings/ProjectVersion.txt")"
if [ "$host" = darwin ]; then
  editor="${UNITY_EDITOR:-/Applications/Unity/Hub/Editor/$version/Unity.app/Contents/MacOS/Unity}"
else
  editor="${UNITY_EDITOR:-$HOME/Unity/Hub/Editor/$version/Editor/Unity}"
fi
if [[ ! -x "$editor" ]]; then
  echo "Set UNITY_EDITOR to the executable for Unity $version." >&2
  exit 1
fi
exec "$editor" "$@"
