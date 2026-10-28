#!/bin/sh
set -eu
umask 077
CDPATH='' cd "$(dirname "$0")"
set -a
. ./runtime-host.env
set +a
export REALTIME_SERVER_EXECUTABLE="$PWD/realtime-server"
exec ./runtime-host
