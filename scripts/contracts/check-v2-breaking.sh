#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${script_dir}/../lib/paths.sh"

mode="${1:-check}"
case "${mode}" in check|generate) ;; *) echo "usage: check-v2-breaking.sh [check|generate] [current.binpb]" >&2; exit 2 ;; esac

baseline="${CONTRACTS_DIR}/presentation/v2/baseline.binpb"
current="${2:-${CONTRACTS_DIR}/presentation/v2/contract.pb}"
report="${CONTRACTS_DIR}/presentation/v2/breaking-report.json"
temporary="$(mktemp -d)"
trap 'rm -rf -- "${temporary}"' EXIT
cp "${current}" "${temporary}/current.binpb"

buf breaking "${temporary}/current.binpb" \
  --against "${baseline}" \
  --config '{"version":"v2","breaking":{"use":["PACKAGE"]}}'

baseline_sha="$(sha256sum "${baseline}" | cut -d ' ' -f 1)"
current_sha="$(sha256sum "${current}" | cut -d ' ' -f 1)"
printf '{\n  "baselineSha256": "%s",\n  "currentSha256": "%s",\n  "policy": "PACKAGE",\n  "breakingChanges": []\n}\n' \
  "${baseline_sha}" "${current_sha}" > "${temporary}/report.json"

if [[ "${mode}" == generate ]]; then
  cp "${temporary}/report.json" "${report}"
else
  cmp "${temporary}/report.json" "${report}"
fi
