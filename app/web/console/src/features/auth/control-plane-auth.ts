import { createControlPlaneAuthClient } from "@unframe/api-client-typescript";
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { authenticatedFetch } from "@/shared/api/authenticated-fetch";
import {
  changePrincipal,
  notifySessionChanged,
  sessionRevision,
  subscribeSessionChanges,
} from "@/shared/api/session-events";

const controlPlaneUrl = import.meta.env["VITE_CONTROL_PLANE_URL"] || "https://api.un-fra.me";

export const controlPlaneAuth = createControlPlaneAuthClient({
  baseUrl: controlPlaneUrl,
  credentials: "include",
  fetch: authenticatedFetch,
});

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof controlPlaneAuth.getSession>>["data"]
>;
export const sessionKey = ["auth", "session"] as const;
const sessionNotificationKey = "unframe.auth.changed";
const isSession = (query: { queryKey: readonly unknown[] }) =>
  query.queryKey[0] === "auth" && query.queryKey[1] === "session";

function discardAccountCache(client: QueryClient) {
  void client.cancelQueries({ predicate: (query) => !isSession(query) });
  client.removeQueries({ predicate: (query) => !isSession(query) });
  client.getMutationCache().clear();
}

export const sessionQuery = queryOptions({
  queryKey: sessionKey,
  queryFn: async ({ signal, client }) => {
    for (;;) {
      const revision = sessionRevision();
      let result: Awaited<ReturnType<typeof controlPlaneAuth.getSession>>;
      try {
        result = await controlPlaneAuth.getSession({ fetchOptions: { signal } });
      } catch (error) {
        signal.throwIfAborted();
        if (revision !== sessionRevision()) continue;
        throw error;
      }
      signal.throwIfAborted();
      if (revision !== sessionRevision()) continue;
      if (result.error && result.error.status !== 401) throw result.error;
      const next = result.data ?? null;
      const previous = client.getQueryData<AuthSession | null>(sessionKey);
      if (previous !== undefined && previous?.user?.id !== next?.user?.id) {
        changePrincipal();
        discardAccountCache(client);
      }
      return next;
    }
  },
  staleTime: (query) => {
    const session = query.state.data?.session;
    if (!session) return 0;
    const expiresAt = new Date(session.expiresAt).getTime();
    return Math.max(0, Math.min(60_000, expiresAt - query.state.dataUpdatedAt));
  },
  retry: false,
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always",
});

export function useAuthSession() {
  return useQuery(sessionQuery);
}

export function updateSessionUser(
  client: QueryClient,
  userId: string,
  fields: Partial<Pick<AuthSession["user"], "name" | "image">>,
) {
  client.setQueryData<AuthSession | null>(sessionKey, (current: AuthSession | null | undefined) =>
    current?.user.id === userId ? { ...current, user: { ...current.user, ...fields } } : current,
  );
}

export async function resetSessionCache(client: QueryClient) {
  changePrincipal();
  await client.cancelQueries();
  client.clear();
  notifySessionChanged();
}

export function connectSessionCache(client: QueryClient) {
  const broadcast = () => {
    try {
      window.localStorage.setItem(sessionNotificationKey, crypto.randomUUID());
    } catch {
      // Session refresh still works locally when browser storage is unavailable.
    }
  };
  const unsubscribe = subscribeSessionChanges((event) => {
    if (!event.remote) broadcast();
    if (event.reason === "unauthorized") {
      changePrincipal();
      void client.cancelQueries({ queryKey: sessionKey });
      discardAccountCache(client);
      client.setQueryData(sessionKey, null);
    }
    void client.invalidateQueries({ queryKey: sessionKey }, { cancelRefetch: false });
  });
  const unlisten = controlPlaneAuth.$store.atoms["$sessionSignal"]!.listen(() =>
    notifySessionChanged(),
  );
  const storage = (event: StorageEvent) => {
    if (event.key === sessionNotificationKey && event.newValue)
      notifySessionChanged("changed", true);
  };
  window.addEventListener("storage", storage);
  broadcast();
  return () => {
    unsubscribe();
    unlisten();
    window.removeEventListener("storage", storage);
  };
}

export async function hasSession(queryClient: QueryClient) {
  try {
    return Boolean(await queryClient.fetchQuery(sessionQuery));
  } catch {
    return false;
  }
}
