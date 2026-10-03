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
proto_files=(
  "${proto_root}/unframe/presentation/v2/runtime.proto"
  "${proto_root}/unframe/delivery/v2/delivery.proto"
  "${proto_root}/unframe/realtime/v2/realtime.proto"
)
service_proto_files=(
  "${proto_root}/unframe/realtime/v2/realtime.proto"
)

generate() {
  local destination="$1"
  protoc --proto_path="${proto_root}" \
    --go_out="${destination}" --go_opt="module=${module}" \
    "${proto_files[@]}"
  protoc --proto_path="${proto_root}" \
    --go-grpc_out="${destination}" --go-grpc_opt="module=${module}" \
    "${service_proto_files[@]}"
}

temporary_output="$(mktemp -d)"
trap 'rm -rf "${temporary_output}"' EXIT
generate "${temporary_output}"

if [[ "${mode}" == "generate" ]]; then
  rm -rf -- "${output_root}/internal/gen"
  cp -R -- "${temporary_output}/internal/gen" "${output_root}/internal/gen"
  exit 0
fi

generated_files=(
  "internal/gen/presentation/v2/runtime.pb.go"
  "internal/gen/delivery/v2/delivery.pb.go"
  "internal/gen/realtime/v2/realtime.pb.go"
  "internal/gen/realtime/v2/realtime_grpc.pb.go"
)
drift=0
expected_files="${temporary_output}/expected-files"
actual_files="${temporary_output}/actual-files"
printf '%s\n' "${generated_files[@]}" | LC_ALL=C sort > "${expected_files}"
(cd "${output_root}" && find internal/gen -type f -name '*.go' | LC_ALL=C sort) > "${actual_files}"
if ! cmp -s "${expected_files}" "${actual_files}"; then
  diff -u "${expected_files}" "${actual_files}" || true
  echo "generated protobuf Go file set is stale" >&2
  drift=1
fi
for generated_file in "${generated_files[@]}"; do
  if ! cmp -s "${output_root}/${generated_file}" "${temporary_output}/${generated_file}"; then
    diff -u "${output_root}/${generated_file}" "${temporary_output}/${generated_file}" || true
    drift=1
  fi
done
if [[ "${drift}" -ne 0 ]]; then
  echo "generated Realtime/Delivery/Presentation protobuf Go files are stale; run scripts/contracts/generate-proto.sh" >&2
  exit 1
fi
