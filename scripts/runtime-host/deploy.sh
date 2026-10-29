#!/usr/bin/env bash
set -euo pipefail
umask 022
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
output="${1:-}"
service_user="${2:-}"
if [[ $(uname -s) != Darwin || $# != 2 || "$output" != /* || -e "$output" || -L "$output" || ! "$service_user" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]; then
  echo 'usage (macOS): runtime-host-deploy /absolute/new-release-directory non-root-user' >&2
  exit 2
fi
service_uid="$(id -u "$service_user")"
if [[ "$service_uid" == 0 ]]; then
  echo 'Runtime Host must run as a non-root user.' >&2
  exit 2
fi
mkdir -p "$(dirname "$output")"
stage="$(mktemp -d "${output}.XXXXXXXX")"
trap 'rm -rf "$stage"' EXIT
CGO_ENABLED=0 go -C "$root/app/server/realtime" build -trimpath -o "$stage/runtime-host" ./cmd/runtime-host
cp "$root/app/server/realtime/ops/start-launchd.sh" "$stage/start.sh"
cp "$root/app/server/realtime/ops/runtime-host.env.example" "$stage/runtime-host.env.example"
sed "s/@USER@/$service_user/g" "$root/app/server/realtime/ops/me.un-fra.realtime.plist" > "$stage/me.un-fra.realtime.plist"
/usr/bin/plutil -lint "$stage/me.un-fra.realtime.plist"
chmod 755 "$stage/start.sh"
mv "$stage" "$output"
echo "Prepared release: $output"
