import { AudienceConnectionError } from "./http-client";
import type { PreparedConnection } from "./join-controller";

export function createAudienceAssetFetch(
  connection: () => Pick<PreparedConnection, "session" | "bootstrap">,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): typeof fetch {
  const requestFetch = options.fetch ?? globalThis.fetch;
  return async (input, init) => {
    const current = connection();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const assetPrefix = `/sessions/${current.session.id}/assets/`;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.delete("Authorization");
    if (
      current.bootstrap.runtimeKind === "VenueEdge" &&
      url.origin === new URL(current.bootstrap.endpoint).origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith(assetPrefix) &&
      /^[A-Za-z0-9_-]+$/.test(url.pathname.slice(assetPrefix.length))
    ) {
      if (Date.parse(current.bootstrap.expiresAt) <= (options.now ?? Date.now)())
        throw new AudienceConnectionError("expired-bootstrap");
      headers.set("Authorization", `Bearer ${current.bootstrap.credential}`);
    }
    return requestFetch(input, {
      ...init,
      headers,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  };
}
