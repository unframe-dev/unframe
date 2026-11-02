import { notifySessionChanged, principalRevision, sessionRevision } from "./session-events";

export const authenticatedFetch: typeof globalThis.fetch = async (input, init) => {
  const revision = sessionRevision();
  const principal = principalRevision();
  const response = await globalThis.fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  const authRequest = url.pathname.startsWith("/api/auth/");
  const publicAuthRequest =
    /^\/api\/auth\/(sign-in|sign-up)\//.test(url.pathname) ||
    [
      "/api/auth/get-session",
      "/api/auth/request-password-reset",
      "/api/auth/reset-password",
      "/api/auth/send-verification-email",
      "/api/auth/verify-email",
    ].includes(url.pathname);
  const protectedRequest = !authRequest || !publicAuthRequest;
  if (protectedRequest && principal !== principalRevision()) {
    throw new DOMException("The signed-in account changed", "AbortError");
  }
  if (response.status === 401 && protectedRequest && revision === sessionRevision()) {
    notifySessionChanged(authRequest ? "changed" : "unauthorized");
  }
  return response;
};
