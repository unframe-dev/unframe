#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${script_dir}/../lib/paths.sh"

temporary="$(mktemp -d)"
trap 'rm -rf -- "${temporary}"' EXIT
cp -R "${CONTRACTS_DIR}/proto" "${temporary}/proto"
runtime="${temporary}/proto/unframe/presentation/runtime.proto"
sed 's/string presentation_id = 1;/uint32 presentation_id = 1;/' "${runtime}" > "${temporary}/changed-runtime.proto"
mv "${temporary}/changed-runtime.proto" "${runtime}"
protoc --proto_path="${temporary}/proto" --include_imports \
  --descriptor_set_out="${temporary}/changed.binpb" \
  unframe/presentation/runtime.proto unframe/delivery/delivery.proto unframe/realtime/realtime.proto
if "${script_dir}/check-breaking.sh" check "${temporary}/changed.binpb" >"${temporary}/result" 2>&1; then
  echo "breaking check accepted a changed field type" >&2
  exit 1
fi
grep -q 'changed type' "${temporary}/result"

cp -R "${CONTRACTS_DIR}/proto" "${temporary}/removed-proto"
runtime="${temporary}/removed-proto/unframe/presentation/runtime.proto"
sed '/string publication_manifest_hash = 3;/d' "${runtime}" > "${temporary}/removed-runtime.proto"
mv "${temporary}/removed-runtime.proto" "${runtime}"
protoc --proto_path="${temporary}/removed-proto" --include_imports \
  --descriptor_set_out="${temporary}/removed.binpb" \
  unframe/presentation/runtime.proto unframe/delivery/delivery.proto unframe/realtime/realtime.proto
if "${script_dir}/check-breaking.sh" check "${temporary}/removed.binpb" >"${temporary}/result" 2>&1; then
  echo "breaking check accepted a removed field" >&2
  exit 1
fi
grep -q 'deleted' "${temporary}/result"
