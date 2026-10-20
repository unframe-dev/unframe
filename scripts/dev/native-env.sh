#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=../lib/native-host.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/native-host.sh"
configure_native_environment
exec "$@"
