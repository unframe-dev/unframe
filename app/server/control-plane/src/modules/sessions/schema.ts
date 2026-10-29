import { z } from "zod";
import { sessionStateSchema, sessionJoinCodeSchema } from "@unframe/contracts/control-plane-http";

export { sessionStateSchema };
export const joinCodeSchema = sessionJoinCodeSchema;
export const sessionRoleSchema = z.enum(["presenter", "viewer"]);

export type SessionState = z.infer<typeof sessionStateSchema>;
export type SessionRole = z.infer<typeof sessionRoleSchema>;
