import { z } from "zod";

const requiredString = (name: string) => z.string().trim().min(1, `${name} is required`);
const binding = <T>(name: string, methods: readonly string[]) =>
  z.custom<T>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      methods.every((method) => typeof (value as Record<string, unknown>)[method] === "function"),
    `${name} binding is required`,
  );

const originUrl = (name: string) =>
  requiredString(name)
    .url(`${name} must be a URL`)
    .refine(
      (value) => {
        const url = new URL(value);
        return url.origin === value;
      },
      `${name} must be an origin URL`,
    );

const runtimeConfigSchema = z.object({
  DB: binding<D1Database>("DB", ["prepare", "batch", "exec"]),
  ASSETS: binding<R2Bucket>("ASSETS", ["head", "get", "put", "delete", "list"]),
  BETTER_AUTH_SECRET: requiredString("BETTER_AUTH_SECRET").min(
    32,
    "BETTER_AUTH_SECRET must be at least 32 characters",
  ),
  BETTER_AUTH_URL: requiredString("BETTER_AUTH_URL").url("BETTER_AUTH_URL must be a URL"),
  DEVICE_CLIENT_ID: requiredString("DEVICE_CLIENT_ID"),
  GOOGLE_CLIENT_ID: requiredString("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: requiredString("GOOGLE_CLIENT_SECRET"),
  RESEND_API_KEY: requiredString("RESEND_API_KEY"),
  AUTH_EMAIL_FROM: requiredString("AUTH_EMAIL_FROM").email("AUTH_EMAIL_FROM must be an email"),
  WEB_ORIGIN: originUrl("WEB_ORIGIN"),
  R2_ACCOUNT_ID: requiredString("R2_ACCOUNT_ID").refine(
    (value) => value !== "replace-with-r2-account-id",
    "R2_ACCOUNT_ID must not use the configured placeholder",
  ),
  R2_BUCKET_NAME: requiredString("R2_BUCKET_NAME"),
  R2_ACCESS_KEY_ID: requiredString("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: requiredString("R2_SECRET_ACCESS_KEY"),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type AppEnvironment = {
  Bindings: CloudflareBindings;
  Variables: { config: RuntimeConfig };
};

export class ConfigurationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Invalid Worker configuration: ${fields.join(", ")}`);
    this.name = "ConfigurationError";
  }
}

export function validateConfig(environment: unknown): RuntimeConfig {
  const parsed = runtimeConfigSchema.safeParse(environment);
  if (parsed.success) {
    return parsed.data;
  }

  throw new ConfigurationError([...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]);
}
