import { betterAuth, type BetterAuthOptions } from "better-auth";
import { dash } from "@better-auth/infra";
import { bearer, twoFactor } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { openAPI } from "better-auth/plugins";
import type { RuntimeConfig } from "../config";
import { createResendMailer, passwordResetEmail, type AuthMailer, verificationEmail } from "./mail";

export type AuthConfiguration = Pick<
  RuntimeConfig,
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "BETTER_AUTH_API_KEY"
  | "DEVICE_CLIENT_ID"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "RESEND_API_KEY"
  | "AUTH_EMAIL_FROM"
  | "WEB_ORIGIN"
>;

type AuthRuntime = {
  backgroundTaskHandler?: (task: Promise<unknown>) => void;
  mailer?: AuthMailer;
  onPasswordReset?: (userId: string) => Promise<void>;
};

export function createAuthOptions(
  env: AuthConfiguration,
  database: BetterAuthOptions["database"],
  runtime: AuthRuntime = {},
) {
  const mailer = runtime.mailer ?? createResendMailer(env.RESEND_API_KEY, env.AUTH_EMAIL_FROM);
  return {
    account: {
      accountLinking: {
        enabled: true,
        requireLocalEmailVerified: false,
      },
    },
    baseURL: env.BETTER_AUTH_URL,
    database,
    databaseHooks: {
      session: {
        create: {
          before: async (session: Record<string, unknown>, context: { path?: string } | null) => {
            const path = context?.path;
            const assurance =
              path === "/callback/google" || path === "/sign-in/social"
                ? "google"
                : path === "/device/token"
                  ? "device"
                  : path === "/sign-in/email" || path?.startsWith("/two-factor/verify-")
                    ? "password_mfa"
                    : "none";
            return { data: { ...session, assurance } };
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ url, user }: { url: string; user: { email: string } }) => {
        await mailer({ to: user.email, ...passwordResetEmail(url) });
      },
      ...(runtime.onPasswordReset
        ? {
            onPasswordReset: async ({ user }: { user: { id: string } }) =>
              runtime.onPasswordReset!(user.id),
          }
        : {}),
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendVerificationEmail: async ({ url, user }: { url: string; user: { email: string } }) => {
        await mailer({ to: user.email, ...verificationEmail(url) });
      },
    },
    plugins: [
      dash({ apiKey: env.BETTER_AUTH_API_KEY }),
      bearer(),
      deviceAuthorization({
        expiresIn: "30m",
        interval: "3s",
        validateClient: (clientId) => clientId === env.DEVICE_CLIENT_ID,
        verificationUri: `${env.WEB_ORIGIN}/editor/device`,
      }),
      twoFactor({
        accountLockout: { durationSeconds: 900, enabled: true, maxFailedAttempts: 10 },
        backupCodeOptions: { storeBackupCodes: "encrypted" },
        issuer: "Unframe",
      }),
      openAPI({ disableDefaultReference: true }),
    ],
    secret: env.BETTER_AUTH_SECRET,
    session: {
      additionalFields: {
        assurance: { defaultValue: "none", input: false, type: "string" as const },
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    trustedOrigins: [env.WEB_ORIGIN],
    user: {
      additionalFields: {
        globalRole: {
          defaultValue: "user",
          input: false,
          type: "string" as const,
        },
      },
    },
    ...(runtime.backgroundTaskHandler
      ? { advanced: { backgroundTasks: { handler: runtime.backgroundTaskHandler } } }
      : {}),
  };
}

export function createAuth(
  env: Pick<RuntimeConfig, "DB"> & AuthConfiguration,
  runtime: Omit<AuthRuntime, "onPasswordReset"> = {},
) {
  const { DB, ...configuration } = env;
  return betterAuth(
    createAuthOptions(configuration, DB, {
      ...runtime,
      onPasswordReset: async (userId) => {
        await DB.batch([
          DB.prepare("DELETE FROM deviceCode WHERE userId = ?").bind(userId),
          DB.prepare("DELETE FROM verification WHERE value = ?").bind(userId),
          DB.prepare("DELETE FROM session WHERE userId = ?").bind(userId),
        ]);
      },
    }),
  );
}
