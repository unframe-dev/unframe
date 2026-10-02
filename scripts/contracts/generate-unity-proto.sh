#!/usr/bin/env bash
# Shared Presentation v2 protobuf contracts の Unity C# binding を生成し、コピーと生成物の drift を検出する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

mode="${1:-generate}"
case "${mode}" in
  generate|check) ;;
  *)
    echo "usage: generate-unity-proto.sh [generate|check]" >&2
    exit 2
    ;;
esac

proto_files=(
  "unframe/presentation/v2/runtime.proto"
  "unframe/delivery/v2/delivery.proto"
  "unframe/realtime/v2/realtime.proto"
)
unity_proto_root="${REPO_ROOT}/app/unity/Assets/Contracts/Proto"
unity_generated_root="${REPO_ROOT}/app/unity/Assets/Scripts/PresentationRuntime/Generated"
temporary_root="$(mktemp -d)"
trap 'rm -rf -- "${temporary_root}"' EXIT

generate() {
  local destination="$1"
  protoc --proto_path="${CONTRACTS_DIR}/proto" --csharp_out="${destination}" "${proto_files[@]}"
  dotnet restore "${REPO_ROOT}/packages/api-client-csharp/Proto/Unframe.Wire.csproj" --verbosity quiet
  local nuget_root grpc_platform grpc_plugin
  nuget_root="$(dotnet nuget locals global-packages --list | sed 's/^global-packages: //')"
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) grpc_platform=linux_x64 ;;
    Linux-aarch64) grpc_platform=linux_arm64 ;;
    Darwin-x86_64) grpc_platform=macosx_x64 ;;
    Darwin-arm64) grpc_platform=macosx_arm64 ;;
    *) echo "unsupported Grpc.Tools platform" >&2; return 1 ;;
  esac
  grpc_plugin="${nuget_root}/grpc.tools/2.76.0/tools/${grpc_platform}/grpc_csharp_plugin"
  test -x "${grpc_plugin}"
  protoc --proto_path="${CONTRACTS_DIR}/proto" "--plugin=protoc-gen-grpc=${grpc_plugin}" \
    --grpc_out="${destination}" unframe/realtime/v2/realtime.proto
}

list_files() {
  local root="$1"
  local extension="$2"
  (
    cd "${root}"
    find . -type f -name "*${extension}" -print | sed 's#^\./##' | LC_ALL=C sort
  )
}

if [[ "${mode}" == "generate" ]]; then
  generated_root="${temporary_root}/generated"
  mkdir -p "${generated_root}"
  generate "${generated_root}"

  expected_proto_files="${temporary_root}/expected-proto-files"
  actual_proto_files="${temporary_root}/actual-proto-files"
  printf '%s\n' "${proto_files[@]}" | LC_ALL=C sort > "${expected_proto_files}"
  list_files "${unity_proto_root}" ".proto" > "${actual_proto_files}"
  comm -23 "${actual_proto_files}" "${expected_proto_files}" | while IFS= read -r stale_file; do
    rm -f "${unity_proto_root}/${stale_file}" "${unity_proto_root}/${stale_file}.meta"
  done
  for proto_file in "${proto_files[@]}"; do
    mkdir -p "${unity_proto_root}/$(dirname "${proto_file}")"
    cp "${CONTRACTS_DIR}/proto/${proto_file}" "${unity_proto_root}/${proto_file}"
  done
  mkdir -p "${unity_generated_root}"
  expected_generated_files="${temporary_root}/expected-generated-files"
  actual_generated_files="${temporary_root}/actual-generated-files"
  list_files "${generated_root}" ".cs" > "${expected_generated_files}"
  list_files "${unity_generated_root}" ".cs" > "${actual_generated_files}"
  comm -23 "${actual_generated_files}" "${expected_generated_files}" | while IFS= read -r stale_file; do
    rm -f "${unity_generated_root}/${stale_file}" "${unity_generated_root}/${stale_file}.meta"
  done
  cp "${generated_root}"/*.cs "${unity_generated_root}/"
  exit 0
fi

check_drift() {
  local source="$1"
  local generated="$2"
  local label="$3"
  if ! cmp -s "${source}" "${generated}"; then
    diff -u "${generated}" "${source}" || true
    echo "${label} is stale; run scripts/contracts/generate-unity-proto.sh" >&2
    return 1
  fi
}

drift=0
expected_proto_files="${temporary_root}/expected-proto-files"
actual_proto_files="${temporary_root}/actual-proto-files"
printf '%s\n' "${proto_files[@]}" | LC_ALL=C sort > "${expected_proto_files}"
list_files "${unity_proto_root}" ".proto" > "${actual_proto_files}"
if ! cmp -s "${expected_proto_files}" "${actual_proto_files}"; then
  diff -u "${expected_proto_files}" "${actual_proto_files}" || true
  echo "Unity protobuf source file set is stale; run scripts/contracts/generate-unity-proto.sh" >&2
  drift=1
fi

for proto_file in "${proto_files[@]}"; do
  if ! check_drift \
    "${CONTRACTS_DIR}/proto/${proto_file}" \
    "${unity_proto_root}/${proto_file}" \
    "Unity protobuf source copy ${proto_file}"; then
    drift=1
  fi
done

generated_root="${temporary_root}/generated"
mkdir -p "${generated_root}"
generate "${generated_root}"

expected_files="${temporary_root}/expected-files"
actual_files="${temporary_root}/actual-files"
list_files "${generated_root}" ".cs" > "${expected_files}"
list_files "${unity_generated_root}" ".cs" > "${actual_files}"
if ! cmp -s "${expected_files}" "${actual_files}"; then
  diff -u "${expected_files}" "${actual_files}" || true
  echo "Unity protobuf generated C# file set is stale; run scripts/contracts/generate-unity-proto.sh" >&2
  drift=1
fi

while IFS= read -r generated_file; do
  if ! check_drift \
    "${generated_root}/${generated_file}" \
    "${unity_generated_root}/${generated_file}" \
    "Unity protobuf generated file ${generated_file}"; then
    drift=1
  fi
done < "${expected_files}"

if [[ "${drift}" -ne 0 ]]; then
  exit 1
fi
