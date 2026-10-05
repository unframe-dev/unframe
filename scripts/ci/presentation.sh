#!/usr/bin/env bash
# packages/unframe-* の品質処理。
#   check (既定): 実装済み package の check
#   fix         : Vite+ formatter
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/paths.sh
source "${DIR}/../lib/paths.sh"

manifest() {
  local dist="$1/dist"
  test -L "${dist}"
  test -f "${dist}/definition.json"
  test -f "${dist}/render-bundle.json"
  test -f "${dist}/asset-set.json"
  test -f "${dist}/build-manifest.json"
  test -d "${dist}/assets"
  find "${dist}/assets" -type f -name '*.png' -print -quit | grep -q .
  (
    cd "${dist}"
    find . -type f -printf '%P\0' | LC_ALL=C sort -z | xargs -0r sha256sum
  )
}

reference_acceptance() {
  export PLAYWRIGHT_BROWSERS_PATH="${REPO_ROOT}/.cache/playwright"
  if ! find "${PLAYWRIGHT_BROWSERS_PATH}" -type f -name chrome-headless-shell -perm -111 -print -quit | grep -q .; then
    echo "Fixed Browser is not provisioned; run scripts/dev/install-presentation-browser.sh first." >&2
    return 1
  fi
  local temp first_manifest second_manifest
  temp="$(mktemp -d)"
  trap 'rm -rf -- "$temp"' RETURN
  cp -R "${REPO_ROOT}/examples/presentation/." "${temp}/"
  log "presentation(check): reference project check"
  pnpm --dir "${REPO_ROOT}" --filter @unframe/unframe-cli run presentation check "${temp}"
  log "presentation(check): Fixed Browser reference build (first)"
  pnpm --dir "${REPO_ROOT}" --filter @unframe/unframe-cli run presentation build "${temp}"
  first_manifest="$(manifest "${temp}")"
  log "presentation(check): Fixed Browser reference build (second)"
  pnpm --dir "${REPO_ROOT}" --filter @unframe/unframe-cli run presentation build "${temp}"
  second_manifest="$(manifest "${temp}")"
  test "${first_manifest}" = "${second_manifest}"
  log "presentation(check): compiled Delivery wire fixture"
  bun "${REPO_ROOT}/scripts/contracts/generate-valid-delivery.ts" check "${temp}/dist"
  trap - RETURN
  rm -rf "${temp}"
}

mode="${1:-check}"
case "${mode}" in
  fix)
    log "presentation(fix): vp fmt"
    pnpm --config.verify-deps-before-run=false exec vp fmt \
      "${REPO_ROOT}"/packages/unframe-*
    ;;
  check)
    log "presentation(check): shared config / package checks"
    pnpm --config.verify-deps-before-run=false --filter "${CONFIG_FILTER}" run check
    pnpm --config.verify-deps-before-run=false --filter @unframe/contracts run check
    log "presentation(check): generated Go/C# consumers and wire compatibility"
    "${REPO_ROOT}/scripts/contracts/generate-consumers.sh" check
    "${REPO_ROOT}/scripts/contracts/check-breaking.sh" check
    "${REPO_ROOT}/scripts/contracts/test-breaking.sh"
    bash "${REPO_ROOT}/scripts/contracts/test-unity-proto.sh"
    dotnet build "${REPO_ROOT}/packages/api-client-csharp/Proto/Unframe.Wire.csproj" --no-restore --verbosity quiet
    dotnet build "${REPO_ROOT}/packages/api-client-csharp/Generated/ControlPlane/Unframe.ControlPlane.csproj" --verbosity quiet
    dotnet run --project "${REPO_ROOT}/packages/api-client-csharp/Conformance/Unframe.Wire.Conformance.csproj" -- \
      "${REPO_ROOT}/packages/contracts/presentation/fixtures/wire/conformance.json" \
      "${REPO_ROOT}/packages/contracts/presentation/fixtures/wire/valid-delivery.json"
    pnpm --config.verify-deps-before-run=false \
      --filter "${PRESENTATION_PACKAGES_FILTER}" \
      run check
    pnpm --dir "${REPO_ROOT}" --filter @unframe/unframe-compiler exec tsc --noEmit -p "${REPO_ROOT}/examples/presentation/tsconfig.json"
    reference_acceptance
    ;;
  *)
    echo "usage: presentation.sh [check|fix]" >&2
    exit 2
    ;;
esac
