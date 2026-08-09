import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createOpenAPIDocument } from "../src/openapi";

const normalizePath = (path: string) => path.replace(/:([^/]+)/g, "{$1}");

describe("Control Plane OpenAPI", () => {
  it("documents every public presentation and asset route", () => {
    const actual = new Set(
      createApp()
        .routes.filter(
          (route) => route.path.startsWith("/presentations") || route.path.startsWith("/assets"),
        )
        .map((route) => `${route.method.toLowerCase()} ${normalizePath(route.path)}`),
    );
    const document = createOpenAPIDocument();
    const documented = new Set(
      Object.entries(document.paths).flatMap(([path, methods]) =>
        Object.keys(methods ?? {}).map((method) => `${method} ${path}`),
      ),
    );

    expect(documented).toEqual(actual);
  });

  it("declares both Bearer and browser cookie sessions", () => {
    const schemes = createOpenAPIDocument().components?.securitySchemes;
    expect(schemes).toMatchObject({
      bearerAuth: { type: "http", scheme: "bearer" },
      cookieSession: {
        type: "apiKey",
        in: "cookie",
        name: "__Secure-better-auth.session_token",
      },
    });
  });
});
