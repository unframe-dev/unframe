import { expect, it } from "vitest";
import {
  AssetLoadError,
  getAssetFailure,
  sanitizeAssetFailure,
} from "../../diagnostics/asset-failure";
it("exports only allowlisted failure fields", () => {
  const failure = {
    kind: "png",
    stage: "response",
    code: "http-error",
    httpStatus: 403,
    url: "https://secret/?token=secret",
    cause: new Error("secret"),
  };
  expect(sanitizeAssetFailure(failure)).toEqual({
    kind: "png",
    stage: "response",
    code: "http-error",
    httpStatus: 403,
  });
  expect(getAssetFailure(new AssetLoadError(failure as never, "safe"))).toEqual({
    kind: "png",
    stage: "response",
    code: "http-error",
    httpStatus: 403,
  });
  expect(getAssetFailure(new Error("https://secret"))).toBeNull();
});
it.each([{ kind: "https://secret" }, { stage: "https://secret" }, { code: "https://secret" }])(
  "rejects unknown failure classifications %j",
  (patch) => {
    expect(
      sanitizeAssetFailure({ kind: "png", stage: "request", code: "network-error", ...patch }),
    ).toBeNull();
  },
);
it.each([0, 99, 600, NaN, Infinity, 403.5, "403"])("omits invalid HTTP status %s", (httpStatus) => {
  expect(
    sanitizeAssetFailure({ kind: "png", stage: "request", code: "network-error", httpStatus }),
  ).toEqual({ kind: "png", stage: "request", code: "network-error" });
});

it("rejects invalid constructor details without including the rejected value", () => {
  expect(
    () => new AssetLoadError({ kind: "png", stage: "request", code: "https://secret" } as never),
  ).toThrow("Invalid asset failure details");
});
