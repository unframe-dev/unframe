import { describe, expect, it } from "vitest";
import { createApp, createOpenAPIDocument } from "../src/app";

const normalizePath = (path: string) => path.replace(/:([^/]+)/g, "{$1}");

describe("Control Plane OpenAPI", () => {
  it("documents every product-owned public route", () => {
    const actual = new Set(
      createApp()
        .routes.filter(
          (route) =>
            route.method !== "ALL" &&
            (route.path.startsWith("/presentations") ||
              route.path.startsWith("/assets") ||
              route.path.startsWith("/sessions") ||
              route.path.startsWith("/venue-edges") ||
              route.path.startsWith("/callbacks") ||
              route.path === "/.well-known/jwks.json"),
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

  it("declares user, browser, service, and Venue Edge authentication separately", () => {
    const schemes = createOpenAPIDocument().components?.securitySchemes;
    expect(schemes).toMatchObject({
      bearerAuth: { type: "http", scheme: "bearer" },
      cookieSession: {
        type: "apiKey",
        in: "cookie",
        name: "__Secure-better-auth.session_token",
      },
      serviceBearer: { type: "http", scheme: "bearer" },
      edgeBearer: { type: "http", scheme: "bearer" },
    });
  });

  it("uses Venue Edge credentials only for Edge-owned operations", () => {
    const document = createOpenAPIDocument();

    expect(document.paths["/venue-edges/{edgeId}/register"]?.post?.security).toEqual([
      { edgeBearer: [] },
    ]);
    expect(
      document.paths["/venue-edges/{edgeId}/assignments/{sessionId}/{assignmentEpoch}/renew"]?.post
        ?.security,
    ).toEqual([{ edgeBearer: [] }]);
  });

  it("declares credential expiry conflicts for provisioning and rotation", () => {
    const document = createOpenAPIDocument();

    expect(document.paths["/venue-edges"]?.post?.responses?.[409]).toBeDefined();
    expect(document.paths["/venue-edges/{edgeId}/rotate"]?.post?.responses?.[409]).toBeDefined();
  });

  it("marks every JSON request body as required", () => {
    const document = createOpenAPIDocument();
    const requestBodies = Object.values(document.paths).flatMap((methods) =>
      Object.values(methods ?? {}).flatMap((operation) =>
        operation && typeof operation === "object" && "requestBody" in operation
          ? [operation.requestBody]
          : [],
      ),
    );

    expect(requestBodies.length).toBeGreaterThan(0);
    expect(requestBodies).toEqual(
      expect.arrayContaining(requestBodies.map(() => expect.objectContaining({ required: true }))),
    );
  });
});
