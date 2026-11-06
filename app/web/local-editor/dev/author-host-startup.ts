import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { Plugin } from "vite";

const listening = (target: URL, signal: AbortSignal) =>
  new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const socket = connect({ host: target.hostname, port: Number(target.port || 80) });
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      socket.destroy();
      resolve(ready);
    };
    const cancel = () => finish(false);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });

export function authorHostStartup(timeoutMilliseconds = 20_000): Plugin {
  return {
    name: "unframe-author-host-startup",
    apply: "serve",
    configureServer(server) {
      const connected = new Set<string>();
      server.middlewares.use((request, response, next) => {
        const route = /^\/(api|unity-preview)(?:\/|$)/.exec(request.url ?? "");
        if (!route) return next();
        const proxy = server.config.server.proxy?.[`/${route[1]}`];
        const target = typeof proxy === "string" ? proxy : proxy?.target;
        if (typeof target !== "string") return next();
        const origin = new URL(target);
        const disconnected = new AbortController();
        const cancel = () => disconnected.abort();
        response.once("close", cancel);
        request.once("aborted", cancel);
        const signal = AbortSignal.any([
          disconnected.signal,
          AbortSignal.timeout(timeoutMilliseconds),
        ]);
        void (async () => {
          try {
            // Wait before proxying so a write is never replayed after a connection failure.
            while (!signal.aborted) {
              if (await listening(origin, signal)) {
                if (!signal.aborted) {
                  connected.add(origin.origin);
                  next();
                }
                return;
              }
              await delay(50, undefined, { signal }).catch(() => {});
            }
            if (disconnected.signal.aborted) return;
            response.writeHead(503, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Retry-After": "1",
            });
            response.end(
              JSON.stringify({
                code: "author-host-unavailable",
                message: connected.has(origin.origin)
                  ? "CLI API connection was lost. Restart the Local Editor development command."
                  : "CLI API did not become ready. Restart the Local Editor development command.",
              }),
            );
          } catch (error) {
            next(error);
          } finally {
            response.removeListener("close", cancel);
            request.removeListener("aborted", cancel);
          }
        })();
      });
    },
  };
}
