import type { Context } from "hono";
import type { Identity } from "../presentation/service";
import { createAuth, type AuthEnvironment } from "./options";

export async function identityFromSession(
  context: Context<{ Bindings: CloudflareBindings }>,
): Promise<Identity | undefined> {
  if (!context.env || !("DB" in context.env)) return undefined;
  const session = await createAuth(context.env as unknown as AuthEnvironment).api.getSession({
    headers: context.req.raw.headers,
  });
  if (!session) return undefined;
  return {
    userId: session.user.id,
    globalRole:
      "globalRole" in session.user && session.user.globalRole === "admin" ? "admin" : "user",
  };
}
