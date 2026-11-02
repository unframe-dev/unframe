#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
project="${1:?Provide an absolute empty project directory.}"
case "${project}" in /*) ;; *) echo "Project path must be absolute." >&2; exit 1 ;; esac
if [[ ! -d "${project}" || -n "$(ls -A "${project}")" ]]; then
  echo "Project directory must already exist and be empty." >&2
  exit 1
fi
cp -R "${root}/packages/unframe/cli/test/fixtures/pack-project/." "${project}/"
gzip -dc "${root}/packages/unframe/cli/test/fixtures/pack-project.lock.gz" > "${project}/unframe.lock"
mkdir -p "${project}/node_modules/@unframe"
ln -s "${root}/packages/unframe/authoring" "${project}/node_modules/@unframe/authoring"
