import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { hasSession } from "./control-plane-auth";

export async function requireSession(queryClient: QueryClient) {
  if (!(await hasSession(queryClient))) {
    throw redirect({ to: "/login", replace: true });
  }
}
