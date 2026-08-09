import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { createAuthOptions } from "./src/auth/options";

const database = new DatabaseSync(process.env.BETTER_AUTH_DATABASE_URL ?? ":memory:");

export const auth = betterAuth(
  createAuthOptions(
    {
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? "development-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:8787",
      DEVICE_CLIENT_ID: process.env.DEVICE_CLIENT_ID ?? "unframe-unity",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "schema-generation-client",
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "schema-generation-secret",
      WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    },
    database,
  ),
);
