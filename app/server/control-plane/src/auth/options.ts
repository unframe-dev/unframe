import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { openAPI } from "better-auth/plugins";

export type AuthEnvironment = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DEVICE_CLIENT_ID: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  WEB_ORIGIN: string;
};

export function createAuthOptions(
  env: Omit<AuthEnvironment, "DB">,
  database: BetterAuthOptions["database"],
) {
  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database,
    trustedOrigins: [env.WEB_ORIGIN],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    user: {
      additionalFields: {
        globalRole: {
          type: "string" as const,
          input: false,
          defaultValue: "user",
        },
      },
    },
    plugins: [
      bearer(),
      deviceAuthorization({
        expiresIn: "30m",
        interval: "3s",
        verificationUri: `${env.WEB_ORIGIN}/device`,
        validateClient: (clientId) => clientId === env.DEVICE_CLIENT_ID,
      }),
      openAPI({ disableDefaultReference: true }),
    ],
  };
}

export function createAuth(env: AuthEnvironment) {
  const { DB, ...configuration } = env;
  return betterAuth(createAuthOptions(configuration, DB));
}
