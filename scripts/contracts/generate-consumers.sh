#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${script_dir}/../lib/paths.sh"
# shellcheck source=../lib/grpc-tools.sh
source "${script_dir}/../lib/grpc-tools.sh"

mode="${1:-generate}"
case "${mode}" in generate|check) ;; *) echo "usage: generate-consumers.sh [generate|check]" >&2; exit 2 ;; esac

test "$(protoc --version)" = "libprotoc 35.1"
test "$(protoc-gen-go --version)" = "protoc-gen-go v1.36.11"
test "$(protoc-gen-go-grpc --version)" = "protoc-gen-go-grpc 1.6.2"
test "$(openapi-generator-cli version)" = "7.22.0"

temp="$(mktemp -d)"
trap 'rm -rf -- "${temp}"' EXIT
proto_root="${CONTRACTS_DIR}/proto"
go_module="github.com/unframe-dev/unframe/app/server/realtime"
protos=(
  unframe/presentation/runtime.proto
  unframe/delivery/delivery.proto
  unframe/realtime/realtime.proto
)
mkdir -p "${temp}/go" "${temp}/csharp/proto"
protoc --proto_path="${proto_root}" \
  --go_out="${temp}/go" --go_opt="module=${go_module}" \
  --go-grpc_out="${temp}/go" --go-grpc_opt="module=${go_module}" \
  "${protos[@]}"
protoc --proto_path="${proto_root}" --csharp_out="${temp}/csharp/proto" "${protos[@]}"
dotnet restore "${REPO_ROOT}/packages/api-client-csharp/Proto/Unframe.Wire.csproj" --verbosity quiet
nuget_root="$(dotnet nuget locals global-packages --list | sed 's/^global-packages: //')"
grpc_platform="$(grpc_tools_platform "$(uname -s)" "$(uname -m)")"
grpc_plugin="${nuget_root}/grpc.tools/2.76.0/tools/${grpc_platform}/grpc_csharp_plugin"
if [[ ! -x "${grpc_plugin}" ]]; then
  echo "Grpc.Tools plugin is missing or not executable: ${grpc_plugin}" >&2
  exit 1
fi
protoc --proto_path="${proto_root}" \
  "--plugin=protoc-gen-grpc=${grpc_plugin}" \
  --grpc_out="${temp}/csharp/proto" \
  unframe/realtime/realtime.proto
openapi-generator-cli generate \
  -g csharp \
  -i "${CONTRACTS_DIR}/openapi/control-plane.openapi.json" \
  -o "${temp}/openapi" \
  --additional-properties=packageName=Unframe.ControlPlane,packageVersion=1.0.0,library=generichost,targetFramework=net8.0,nullableReferenceTypes=true,hideGenerationTimestamp=true \
  --global-property=apiDocs=false,apiTests=false,modelDocs=false,modelTests=false \
  >/dev/null
rm -f -- "${temp}/openapi/src/Unframe.ControlPlane/README.md"
bun "${script_dir}/normalize-csharp-source.ts" "${temp}/openapi/src/Unframe.ControlPlane"

{
  sha256sum "${CONTRACTS_DIR}/openapi/control-plane.openapi.json"
  for proto in "${protos[@]}"; do sha256sum "${proto_root}/${proto}"; done
} | sed -e "s#${CONTRACTS_DIR}/##" > "${temp}/provenance.sha256"
{
  printf 'protoc=%s\n' "$(protoc --version)"
  printf 'protoc-gen-go=%s\n' "$(protoc-gen-go --version)"
  printf 'protoc-gen-go-grpc=%s\n' "$(protoc-gen-go-grpc --version)"
  printf 'openapi-generator-cli=%s\n' "$(openapi-generator-cli version)"
  printf 'Grpc.Tools=2.76.0\n'
} >> "${temp}/provenance.sha256"

sync_tree() {
  local source="$1" destination="$2" label="$3"
  if [[ "${mode}" == check ]]; then
    if ! diff -qr --exclude=bin --exclude=obj "${source}" "${destination}"; then
      echo "${label} generated artifact drift; run scripts/contracts/generate-consumers.sh" >&2
      return 1
    fi
  else
    rm -rf -- "${destination}"
    mkdir -p "$(dirname "${destination}")"
    cp -R -- "${source}" "${destination}"
  fi
}

sync_tree "${temp}/go/internal/gen/presentation" "${REALTIME_SERVER_DIR}/internal/gen/presentation" 'Go Presentation'
sync_tree "${temp}/go/internal/gen/delivery" "${REALTIME_SERVER_DIR}/internal/gen/delivery" 'Go Delivery'
sync_tree "${temp}/go/internal/gen/realtime" "${REALTIME_SERVER_DIR}/internal/gen/realtime" 'Go Realtime'
sync_tree "${temp}/csharp/proto" "${REPO_ROOT}/packages/api-client-csharp/Generated/Proto" 'C# Protobuf'
sync_tree "${temp}/openapi/src/Unframe.ControlPlane" "${REPO_ROOT}/packages/api-client-csharp/Generated/ControlPlane" 'C# Control Plane'
if [[ "${mode}" == check ]]; then
  cmp "${temp}/provenance.sha256" "${REPO_ROOT}/packages/api-client-csharp/Generated/provenance.sha256"
else
  cp "${temp}/provenance.sha256" "${REPO_ROOT}/packages/api-client-csharp/Generated/provenance.sha256"
fi
