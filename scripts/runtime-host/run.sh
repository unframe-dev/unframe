#!/usr/bin/env bash
set -euo pipefail
umask 077
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
mkdir -p "$root/.unframe/runtime-host/runs"
state="$(mktemp -d "$root/.unframe/runtime-host/runs/run.XXXXXXXX")"
go -C "$root/app/server/realtime" build -o "$state/realtime-server" ./cmd/server
go -C "$root/app/server/realtime" build -o "$state/runtime-host" ./cmd/runtime-host
export REALTIME_SERVER_EXECUTABLE="$state/realtime-server"
exec "$state/runtime-host"
