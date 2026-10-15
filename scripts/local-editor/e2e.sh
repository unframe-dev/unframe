#!/usr/bin/env bash
set -euo pipefail
umask 077
root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
state="$root/.unframe/unity-preview/e2e/$(date +%Y%m%dT%H%M%S)-$$"
mkdir -p "$state"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -keyout "$state/ca-key.pem" \
  -out "$state/ca.pem" -subj /CN=UnframeLocalEditorE2E \
  -addext basicConstraints=critical,CA:TRUE > /dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout "$state/server-key.pem" \
  -out "$state/server.csr" -subj /CN=localhost > /dev/null 2>&1
cat > "$state/server.ext" <<'EXT'
subjectAltName=DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
basicConstraints=critical,CA:FALSE
EXT
openssl x509 -req -in "$state/server.csr" -CA "$state/ca.pem" -CAkey "$state/ca-key.pem" \
  -CAcreateserial -out "$state/server.pem" -days 2 -extfile "$state/server.ext" > /dev/null 2>&1
export UNFRAME_E2E_STATE="$state"
export NODE_EXTRA_CA_CERTS="$state/ca.pem"
export SSL_CERT_FILE="$state/ca.pem"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$root/.cache/playwright}"
cd "$root"
exec "$root/scripts/dev/opaque-capture-scope.sh" pnpm --filter @unframe/contracts exec tsx ../../scripts/local-editor/e2e.mts "$@"
