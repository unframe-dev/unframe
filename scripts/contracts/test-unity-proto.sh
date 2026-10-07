#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${script_dir}/../lib/paths.sh"

temporary_root="$(mktemp -d)"
trap 'rm -rf -- "${temporary_root}"' EXIT
fixture_root="${temporary_root}/repo"
generated_root="${fixture_root}/app/unity/Assets/Scripts/PresentationRuntime/Generated"
mkdir -p "${fixture_root}/packages/contracts" "${fixture_root}/app/unity/Assets/Contracts/Proto" \
  "${generated_root}" "${fixture_root}/packages/api-client-csharp"
cp -R "${CONTRACTS_DIR}/proto" "${fixture_root}/packages/contracts/proto"
cp -R "${REPO_ROOT}/packages/api-client-csharp/Proto" "${fixture_root}/packages/api-client-csharp/Proto"
export REPO_ROOT="${fixture_root}"

touch "${generated_root}/RealtimeGrpc.cs" "${generated_root}/RealtimeGrpc.cs.meta"
"${script_dir}/generate-unity-proto.sh"
test -s "${generated_root}/RealtimeGrpc.cs"
test -e "${generated_root}/RealtimeGrpc.cs.meta"
for message_file in Runtime Delivery Realtime Preview; do
  test -s "${generated_root}/${message_file}.cs"
done
"${script_dir}/generate-unity-proto.sh" check

touch "${generated_root}/Stale.cs"
if "${script_dir}/generate-unity-proto.sh" check > "${temporary_root}/result" 2>&1; then
  echo "Unity protobuf drift check accepted an obsolete C# source" >&2
  exit 1
fi
grep -q 'Unity protobuf generated C# file set is stale' "${temporary_root}/result"
