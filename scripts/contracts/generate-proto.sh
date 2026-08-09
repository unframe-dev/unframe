#!/usr/bin/env bash
# Realtime Protocol Buffers の Go 生成と、生成物の drift 検出を行う。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-generate}"
case "${mode}" in
  generate|check) ;;
  *)
    echo "usage: generate-proto.sh [generate|check]" >&2
    exit 2
    ;;
esac

proto_root="${CONTRACTS_DIR}/proto"
output_root="${REALTIME_SERVER_DIR}"
module="github.com/unframe-dev/unframe/app/server/realtime"
proto_files=("${proto_root}/unframe/realtime/v1/realtime.proto")

generate() {
  local destination="$1"
  protoc --proto_path="${proto_root}" \
    --go_out="${destination}" --go_opt="module=${module}" \
    --go-grpc_out="${destination}" --go-grpc_opt="module=${module}" \
    "${proto_files[@]}"
}

if [[ "${mode}" == "generate" ]]; then
  generate "${output_root}"
  exit 0
fi

temporary_output="$(mktemp -d)"
trap 'rm -rf "${temporary_output}"' EXIT
generate "${temporary_output}"

generated_files=(
  "internal/gen/realtime/v1/realtime.pb.go"
  "internal/gen/realtime/v1/realtime_grpc.pb.go"
)
drift=0
for generated_file in "${generated_files[@]}"; do
  if ! cmp -s "${output_root}/${generated_file}" "${temporary_output}/${generated_file}"; then
    diff -u "${output_root}/${generated_file}" "${temporary_output}/${generated_file}" || true
    drift=1
  fi
done
if [[ "${drift}" -ne 0 ]]; then
  echo "generated Realtime protobuf Go files are stale; run scripts/contracts/generate-proto.sh" >&2
  exit 1
fi
