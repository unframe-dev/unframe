#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
release="${1:-${REALTIME_RELEASE_DIRECTORY:-$root/.unframe/realtime-release}}"
env_file="${2:-$HOME/.config/unframe/runtime-host.env}"
caddy_config="${CADDY_CONFIG:-$root/app/server/realtime/ops/Caddyfile.funnel.example}"
export TS_SOCKET="${TS_SOCKET:-$HOME/.config/unframe/funnel/tailscaled.sock}"
if [[ $# -gt 2 || "$release" != /* || "$env_file" != /* || ! -r "$env_file" || ! -x "$release/runtime-host" ]]; then
  echo 'usage: runtime-host-funnel [/absolute/release-directory [/absolute/runtime-host.env]]' >&2
  exit 2
fi
host_admin() {
  if [[ -n "${RUNTIME_HOST_ADMIN:-}" ]]; then
    "$RUNTIME_HOST_ADMIN" "$@"
  else
    go -C "$root/app/server/realtime" run ./cmd/runtime-host-admin "$@"
  fi
}
hostname="$(tailscale --socket="$TS_SOCKET" status --json | host_admin funnel-hostname)"
tailscale --socket="$TS_SOCKET" serve status --json | host_admin funnel-vacant
state="$(mktemp -d "${TMPDIR:-/tmp}/unframe-funnel.XXXXXXXX")"
caddy_pid=''
host_pid=''
published=false
cleanup() {
  trap - EXIT INT TERM
  if [[ "$published" == true ]]; then
    tailscale --socket="$TS_SOCKET" funnel --tcp=443 off || true
  fi
  if [[ -z "$caddy_pid" && -s "$state/caddy.pid" ]]; then
    caddy_pid="$(cat "$state/caddy.pid")"
  fi
  for pid in "$host_pid" "$caddy_pid"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
  for pid in "$host_pid" "$caddy_pid"; do
    if [[ -n "$pid" ]]; then wait "$pid" 2>/dev/null || true; fi
  done
  rm -rf "$state"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
set -a
# This is a trusted shell environment file, shared with the launchd deployment.
source "$env_file"
set +a
export REALTIME_RUNTIME_ENDPOINT="https://$hostname"
export REALTIME_LISTEN_ADDR=127.0.0.1:9090
export FUNNEL_HOSTNAME="$hostname"
XDG_CONFIG_HOME="$state/config" XDG_DATA_HOME="$state/data" caddy validate --config "$caddy_config" --adapter caddyfile
# Caddy start waits for its child to confirm successful configuration and binding.
XDG_CONFIG_HOME="$state/config" XDG_DATA_HOME="$state/data" caddy start --config "$caddy_config" --adapter caddyfile --pidfile "$state/caddy.pid"
caddy_pid="$(cat "$state/caddy.pid")"
if [[ ! "$caddy_pid" =~ ^[1-9][0-9]*$ ]] || ! kill -0 "$caddy_pid" 2>/dev/null; then
  echo 'Caddy did not start; refusing to publish Funnel.' >&2
  exit 1
fi
# Also remove a partially applied publication if the CLI fails after configuration.
published=true
tailscale --socket="$TS_SOCKET" funnel --bg --tcp=443 tcp://127.0.0.1:8443
"$release/runtime-host" &
host_pid=$!
echo "Runtime Host endpoint: $REALTIME_RUNTIME_ENDPOINT (Ctrl-C to stop)"
while kill -0 "$host_pid" 2>/dev/null; do
  if ! kill -0 "$caddy_pid" 2>/dev/null; then
    echo 'Caddy stopped; shutting down Runtime Host and Funnel.' >&2
    exit 1
  fi
  sleep 1
done
wait "$host_pid"
