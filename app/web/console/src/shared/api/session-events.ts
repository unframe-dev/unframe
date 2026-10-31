export type SessionEvent = {
  reason: "changed" | "unauthorized";
  remote: boolean;
};

let revision = 0;
let principal = 0;
const listeners = new Set<(event: SessionEvent) => void>();

export function sessionRevision() {
  return revision;
}

export function principalRevision() {
  return principal;
}

export function changePrincipal() {
  principal++;
  revision++;
}

export function notifySessionChanged(reason: SessionEvent["reason"] = "changed", remote = false) {
  revision++;
  for (const listener of listeners) listener({ reason, remote });
}

export function subscribeSessionChanges(listener: (event: SessionEvent) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
