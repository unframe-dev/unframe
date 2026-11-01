import { expect, it } from "vitest";
import * as build from "../src/index.js";

it("exposes fixed source assembly and declaration build through the build package", () => {
  expect(build).toHaveProperty("checkAuthoringProjectAssembly", expect.any(Function));
  expect(build).toHaveProperty("compileDeclarationProject", expect.any(Function));
  expect(build).toHaveProperty("executeRendererPlugin", expect.any(Function));
});

it("identifies fixed PostCSS configuration through the build API", () => {
  expect(build).toHaveProperty("hasPostcssConfig", expect.any(Function));
});

it("rejects an incomplete media port at the build boundary", async () => {
  const result = await build.compileDeclarationProject({}, {}, {}, undefined, undefined as never);
  expect(result).toMatchObject({
    valid: false,
    diagnostics: [{ code: "compiler-invalid-media-adapter" }],
  });
});

it("rejects an invalid opaque source before invoking the bundle port", async () => {
  let invoked = false;
  await expect(
    build.prepareOpaquePrograms(
      {},
      {},
      {},
      {
        bundle: async () => {
          invoked = true;
          return { ok: false, diagnostics: [] };
        },
        mediaTypeFor: () => "application/octet-stream",
      },
    ),
  ).rejects.toBeInstanceOf(build.OpaquePreparationFailure);
  expect(invoked).toBe(false);
});
