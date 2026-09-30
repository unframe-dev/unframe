import { z } from "zod";

const requiredString = (name: string) => z.string().trim().min(1, `${name} is required`);
const binding = <T>(name: string, methods: ReadonlyArray<string>) =>
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
    .refine((value) => {
      const url = new URL(value);
      return url.origin === value;
    }, `${name} must be an origin URL`);

const privateEd25519Jwk = z.string().transform((value, context): JsonWebKey => {
  try {
    const jwk = JSON.parse(value) as JsonWebKey;
    if (jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.d && jwk.x) {
      return jwk;
    }
  } catch {
    // The validation issue below deliberately excludes secret material.
  }
  context.addIssue({
    code: "custom",
    message: "REALTIME_SIGNING_JWK must be an Ed25519 private JWK",
  });
  return z.NEVER;
});

const runtimeConfigSchema = z.object({
  ASSETS: binding<R2Bucket>("ASSETS", ["head", "get", "put", "delete", "list"]),
  AUTH_EMAIL_FROM: requiredString("AUTH_EMAIL_FROM").email("AUTH_EMAIL_FROM must be an email"),
  BETTER_AUTH_API_KEY: requiredString("BETTER_AUTH_API_KEY"),
  BETTER_AUTH_SECRET: requiredString("BETTER_AUTH_SECRET").min(
    32,
    "BETTER_AUTH_SECRET must be at least 32 characters",
  ),
  BETTER_AUTH_URL: requiredString("BETTER_AUTH_URL").url("BETTER_AUTH_URL must be a URL"),
  DB: binding<D1Database>("DB", ["prepare", "batch", "exec"]),
  DEVICE_CLIENT_ID: requiredString("DEVICE_CLIENT_ID"),
  GOOGLE_CLIENT_ID: requiredString("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: requiredString("GOOGLE_CLIENT_SECRET"),
  R2_ACCESS_KEY_ID: requiredString("R2_ACCESS_KEY_ID"),
  R2_ACCOUNT_ID: requiredString("R2_ACCOUNT_ID").refine(
    (value) => value !== "replace-with-r2-account-id",
    "R2_ACCOUNT_ID must not use the configured placeholder",
  ),
  R2_BUCKET_NAME: requiredString("R2_BUCKET_NAME"),
  R2_SECRET_ACCESS_KEY: requiredString("R2_SECRET_ACCESS_KEY"),
  REALTIME_AUDIENCE: requiredString("REALTIME_AUDIENCE"),
  REALTIME_ISSUER: requiredString("REALTIME_ISSUER").url("REALTIME_ISSUER must be a URL"),
  REALTIME_SIGNING_JWK: privateEd25519Jwk,
  REALTIME_SIGNING_KID: requiredString("REALTIME_SIGNING_KID"),
  RESEND_API_KEY: requiredString("RESEND_API_KEY"),
  SERVICE_IDENTITY_SECRET: requiredString("SERVICE_IDENTITY_SECRET").min(
    32,
    "SERVICE_IDENTITY_SECRET must be at least 32 characters",
  ),
  WEB_ORIGIN: originUrl("WEB_ORIGIN"),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type AppEnvironment = {
  // Route handlers consume RuntimeConfig, so generated Worker bindings must not leak into RPC consumers.
  Bindings: object;
  Variables: {
    config: RuntimeConfig;
    identity?: { globalRole: "admin" | "user"; userId: string };
  };
};

export class ConfigurationError extends Error {
  constructor(readonly fields: ReadonlyArray<string>) {
    super(`Invalid Worker configuration: ${fields.join(", ")}`);
    this.name = "ConfigurationError";
  }
}

export function validateConfig(environment: unknown): RuntimeConfig {
  const parsed = runtimeConfigSchema.safeParse(environment);
  if (parsed.success) {
    return parsed.data;
  }

  throw new ConfigurationError([
    ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
  ]);
}
