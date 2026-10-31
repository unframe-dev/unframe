import { z } from "zod";
import { AuthorError } from "./contract.js";

export type PublicationAuthStatus = {
  status: "unconfigured" | "signed-out" | "pending" | "authenticated" | "denied" | "expired";
  userCode?: string;
  verificationUrl?: string;
  expiresAt?: number;
};
export type PublicationTarget = {
  controlPlaneUrl: string;
  webOrigin: string;
  clientId: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
};
export const trustedOrigin = (value: string) => {
  const url = new URL(value);
  if (
    url.origin !== value ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new AuthorError(
      400,
      "publication-origin-invalid",
      "A secure configured origin is required.",
    );
  return url;
};
const codeSchema = z.object({
  device_code: z.string().min(1).max(4096),
  user_code: z.string().min(1).max(256),
  expires_in: z.number().int().positive().max(86400),
  interval: z.number().int().positive().max(300),
  verification_uri_complete: z.string().url(),
});
const tokenSchema = z.object({
  access_token: z
    .string()
    .min(1)
    .max(16384)
    .refine((value) => !/[\r\n]/u.test(value)),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
});
const unavailable = () =>
  new AuthorError(401, "publication-auth-required", "Publication authorization is required.");

export function createPublicationAuth(target?: PublicationTarget) {
  if (target) {
    trustedOrigin(target.controlPlaneUrl);
    trustedOrigin(target.webOrigin);
  }
  const now = target?.now ?? Date.now;
  let epoch = 0;
  let state: PublicationAuthStatus = { status: target ? "signed-out" : "unconfigured" };
  let deviceCode: string | undefined;
  let bearer: string | undefined;
  let nextPoll = 0;
  let interval = 0;
  let poll: Promise<PublicationAuthStatus> | undefined;
  let controller = new AbortController();
  const clear = (status: PublicationAuthStatus["status"]) => {
    ++epoch;
    controller.abort();
    controller = new AbortController();
    deviceCode = undefined;
    bearer = undefined;
    poll = undefined;
    state = { status };
  };
  const view = () => ({ ...state });
  const expire = () => {
    if (state.expiresAt !== undefined && state.expiresAt <= now()) clear("expired");
  };
  const send = (path: string, body: unknown) => {
    if (!target) throw unavailable();
    return (target.fetch ?? globalThis.fetch)(
      new URL(`/api/auth/device/${path}`, target.controlPlaneUrl),
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      },
    );
  };
  return {
    async start(): Promise<PublicationAuthStatus> {
      if (!target)
        throw new AuthorError(
          409,
          "publication-unconfigured",
          "Configure the publication target on the Host.",
        );
      clear("signed-out");
      const expected = epoch;
      const response = await send("code", { client_id: target.clientId });
      if (epoch !== expected) return view();
      const parsed = codeSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success)
        throw new AuthorError(
          502,
          "publication-auth-start-failed",
          "Could not start device authorization.",
        );
      const code = parsed.data;
      const url = new URL(code.verification_uri_complete);
      if (
        url.origin !== target.webOrigin ||
        url.pathname !== "/device" ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.get("user_code") !== code.user_code ||
        [...url.searchParams.keys()].some((key) => key !== "user_code")
      )
        throw new AuthorError(
          502,
          "publication-auth-url-invalid",
          "Approval URL does not match the configured Web origin.",
        );
      if (epoch !== expected) return view();
      deviceCode = code.device_code;
      interval = code.interval * 1000;
      nextPoll = now() + interval;
      state = {
        status: "pending",
        userCode: code.user_code,
        verificationUrl: url.href,
        expiresAt: now() + code.expires_in * 1000,
      };
      return view();
    },
    async status(): Promise<PublicationAuthStatus> {
      expire();
      if (!target || state.status !== "pending" || !deviceCode || now() < nextPoll) return view();
      if (poll) return poll;
      const expected = epoch;
      nextPoll = now() + interval;
      const pending = (async () => {
        try {
          const response = await send("token", {
            client_id: target.clientId,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          });
          const body: unknown = await response.json();
          expire();
          if (expected !== epoch) return view();
          if (!response.ok) {
            const error = z.object({ error: z.string() }).safeParse(body);
            if (error.success && error.data.error === "slow_down") {
              interval += 5000;
              nextPoll = now() + interval;
            } else if (error.success && error.data.error === "authorization_pending") {
              /* Poll at the server-provided interval. */
            } else if (error.success && error.data.error === "expired_token") clear("expired");
            else clear("denied");
            return view();
          }
          const parsed = tokenSchema.safeParse(body);
          if (!parsed.success) {
            clear("denied");
            return view();
          }
          bearer = parsed.data.access_token;
          deviceCode = undefined;
          state = { status: "authenticated", expiresAt: now() + parsed.data.expires_in * 1000 };
          return view();
        } catch {
          if (epoch !== expected) return view();
          throw new AuthorError(
            502,
            "publication-auth-poll-failed",
            "Could not check device authorization.",
          );
        } finally {
          if (epoch === expected) poll = undefined;
        }
      })();
      poll = pending;
      return pending;
    },
    credential(): string {
      expire();
      if (state.status !== "authenticated" || !bearer) throw unavailable();
      return bearer;
    },
    cancel() {
      clear(target ? "signed-out" : "unconfigured");
    },
    close() {
      clear(target ? "signed-out" : "unconfigured");
    },
  };
}
export type PublicationAuth = ReturnType<typeof createPublicationAuth>;
