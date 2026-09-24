import { z } from "zod";

export const sessionStateSchema = z.enum(["Waiting", "Presenting", "Ended"]);
export const sessionRoleSchema = z.enum(["presenter", "viewer"]);
export const joinCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

export type SessionState = z.infer<typeof sessionStateSchema>;
export type SessionRole = z.infer<typeof sessionRoleSchema>;
