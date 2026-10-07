#!/usr/bin/env bash
set -euo pipefail

if [ "${UNFRAME_OPAQUE_INSIDE_SCOPE:-}" != "1" ]; then
  if [ "$#" -eq 0 ]; then
    echo "usage: $0 command [arguments...]" >&2
    exit 2
  fi
  exec systemd-run --user --scope --quiet -p Delegate=yes \
    --setenv=UNFRAME_OPAQUE_INSIDE_SCOPE=1 "$0" "$@"
fi

scope_relative=$(sed -n 's/^0:://p' /proc/self/cgroup)
if [ -z "$scope_relative" ]; then
  echo "cgroup v2 is required for opaque capture" >&2
  exit 1
fi
scope_root="/sys/fs/cgroup${scope_relative}"
host_group="${scope_root}/unframe-host-$$"
mkdir "$host_group"
printf '%s' "$$" >"${host_group}/cgroup.procs"
printf '%s' '+memory +pids' >"${scope_root}/cgroup.subtree_control"
export UNFRAME_OPAQUE_CGROUP_ROOT="$scope_root"
unset UNFRAME_OPAQUE_INSIDE_SCOPE
exec "$@"
