#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/grpc-tools.sh
source "${script_dir}/../lib/grpc-tools.sh"

test "$(grpc_tools_platform Linux x86_64)" = linux_x64
test "$(grpc_tools_platform Linux aarch64)" = linux_arm64
test "$(grpc_tools_platform Darwin x86_64)" = macosx_x64
test "$(grpc_tools_platform Darwin arm64)" = macosx_x64
if grpc_tools_platform Unsupported unknown >/dev/null 2>&1; then
  echo "Grpc.Tools platform selection accepted an unsupported host" >&2
  exit 1
fi
