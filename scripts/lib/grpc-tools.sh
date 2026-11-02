#!/usr/bin/env bash

grpc_tools_platform() {
  case "$1-$2" in
    Linux-x86_64) printf '%s\n' linux_x64 ;;
    Linux-aarch64) printf '%s\n' linux_arm64 ;;
    Darwin-x86_64|Darwin-arm64) printf '%s\n' macosx_universal ;;
    *) echo "unsupported Grpc.Tools platform: $1-$2" >&2; return 1 ;;
  esac
}
