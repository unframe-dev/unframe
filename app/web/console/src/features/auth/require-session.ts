import { redirect } from "@tanstack/react-router";
import { hasSession } from "./control-plane-auth";

export async function requireSession() {
  if (!(await hasSession())) {
    throw redirect({ to: "/login", replace: true });
  }
}
