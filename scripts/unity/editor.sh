#!/usr/bin/env bash
set -euo pipefail
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
version="$(sed -n 's/^m_EditorVersion: //p' "$root/app/unity/ProjectSettings/ProjectVersion.txt")"
editor="${UNITY_EDITOR:-$HOME/Unity/Hub/Editor/$version/Editor/Unity}"
if [[ ! -x "$editor" ]]; then
  echo "Set UNITY_EDITOR to the executable for Unity $version." >&2
  exit 1
fi
exec "$editor" "$@"
