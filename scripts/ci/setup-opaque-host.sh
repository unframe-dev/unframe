#!/usr/bin/env bash
set -euo pipefail

if [ "${GITHUB_ACTIONS:-}" != "true" ] || [ "${RUNNER_OS:-}" != "Linux" ] ||
  [ -z "${GITHUB_ENV:-}" ]; then
  echo "Opaque host setup is only supported on an ephemeral GitHub Linux runner." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
bash "${repo_root}/scripts/ci/allow-opaque-userns.sh"

runner_uid="$(id -u)"
runtime_dir="/run/user/${runner_uid}"
export XDG_RUNTIME_DIR="$runtime_dir"

select_user_bus() {
  if [ -S "${runtime_dir}/bus" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=${runtime_dir}/bus"
  elif [ -S "${runtime_dir}/systemd/private" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=${runtime_dir}/systemd/private"
  else
    unset DBUS_SESSION_BUS_ADDRESS
  fi
}

select_user_bus
if ! systemctl --user show-environment >/dev/null 2>&1; then
  sudo loginctl enable-linger "$runner_uid"
  sudo systemctl start "user@${runner_uid}.service"
  for attempt in 1 2 3 4 5; do
    select_user_bus
    if systemctl --user show-environment >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if [ ! -d "$runtime_dir" ] || [ "$(stat -c %u "$runtime_dir")" != "$runner_uid" ]; then
  echo "The runner's systemd runtime directory is unavailable or belongs to another user." >&2
  exit 1
fi
select_user_bus
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] ||
  ! systemctl --user show-environment >/dev/null; then
  echo "The runner's systemd user manager is unavailable." >&2
  exit 1
fi

printf 'XDG_RUNTIME_DIR=%s\n' "$runtime_dir" >>"$GITHUB_ENV"
printf 'DBUS_SESSION_BUS_ADDRESS=%s\n' "$DBUS_SESSION_BUS_ADDRESS" >>"$GITHUB_ENV"
