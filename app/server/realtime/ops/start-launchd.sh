#!/bin/sh
set -eu
umask 077
CDPATH='' cd "$(dirname "$0")"
set -a
. ./runtime-host.env
set +a
exec ./runtime-host
