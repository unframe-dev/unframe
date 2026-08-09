import type { Context } from "hono";
import type { AppEnvironment } from "../config";
import type { Identity } from "../presentation/service";
import { createAuth } from "./options";

export async function identityFromSession(
  context: Context<AppEnvironment>,
): Promise<Identity | undefined> {
  const config = context.get("config");
  const session = await createAuth(config).api.getSession({
    headers: context.req.raw.headers,
  });
  if (!session) {
    return undefined;
  }
  return {
    userId: session.user.id,
    globalRole:
      "globalRole" in session.user && session.user.globalRole === "admin" ? "admin" : "user",
  };
}
