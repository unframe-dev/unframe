#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${script_dir}/../lib/paths.sh"

temporary_root="$(mktemp -d)"
trap 'rm -rf -- "${temporary_root}"' EXIT
cp "${script_dir}/fixtures/profile-image-upload/"* "${temporary_root}/"
dotnet run --project "${temporary_root}/ProfileImageUpload.csproj" \
  --property:ControlPlaneProject="${REPO_ROOT}/packages/api-client-csharp/Generated/ControlPlane/Unframe.ControlPlane.csproj" \
  --verbosity quiet
