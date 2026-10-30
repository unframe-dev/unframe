import { sessionJoinCodeSchema } from "@unframe/contracts/control-plane-http";

export function readSharedJoinCode(fragment: string): string | null {
  const codes = new URLSearchParams(fragment.slice(1)).getAll("join");
  if (codes.length !== 1) return null;
  const parsed = sessionJoinCodeSchema.safeParse(codes[0]);
  return parsed.success ? parsed.data : null;
}
