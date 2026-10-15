#!/usr/bin/env bash

native_host() {
  case "$(uname -s)/$(uname -m)" in
    Linux/x86_64) printf '%s' linux ;;
    Darwin/arm64) printf '%s' darwin ;;
    *)
      echo "Supported hosts are Linux x86_64 and macOS arm64." >&2
      return 1
      ;;
  esac
}

configure_native_environment() {
  local host
  host="$(native_host)" || return 1
  if [ "$host" = darwin ]; then
    TMPDIR="$(cd -P -- "${TMPDIR:-/tmp}" && pwd -P)"
    export TMPDIR
  fi
}
