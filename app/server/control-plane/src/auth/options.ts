import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer, twoFactor } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { openAPI } from "better-auth/plugins";
import type { RuntimeConfig } from "../config";
import { createResendMailer, passwordResetEmail, type AuthMailer, verificationEmail } from "./mail";

export type AuthConfiguration = Pick<
  RuntimeConfig,
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "DEVICE_CLIENT_ID"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "RESEND_API_KEY"
  | "AUTH_EMAIL_FROM"
  | "WEB_ORIGIN"
>;

type AuthRuntime = {
  mailer?: AuthMailer;
  backgroundTaskHandler?: (task: Promise<unknown>) => void;
  onPasswordReset?: (userId: string) => Promise<void>;
};

export function createAuthOptions(
  env: AuthConfiguration,
  database: BetterAuthOptions["database"],
  runtime: AuthRuntime = {},
) {
  const mailer = runtime.mailer ?? createResendMailer(env.RESEND_API_KEY, env.AUTH_EMAIL_FROM);
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
    account: {
      accountLinking: {
        enabled: true,
        requireLocalEmailVerified: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
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
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await mailer({ to: user.email, ...verificationEmail(url) });
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
    session: {
      additionalFields: {
        assurance: { type: "string" as const, input: false, defaultValue: "none" },
      },
    },
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
    plugins: [
      bearer(),
      deviceAuthorization({
        expiresIn: "30m",
        interval: "3s",
        verificationUri: `${env.WEB_ORIGIN}/device`,
        validateClient: (clientId) => clientId === env.DEVICE_CLIENT_ID,
      }),
      twoFactor({
        issuer: "Unframe",
        backupCodeOptions: { storeBackupCodes: "encrypted" },
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
      }),
      openAPI({ disableDefaultReference: true }),
    ],
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
