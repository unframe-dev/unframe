import { expect, test } from "vitest";
import { readConnectionConfig } from "./application-config";

test("接続情報を仮の値で補わず設定待ちとする", () => {
  expect(readConnectionConfig({})).toEqual({ status: "unconfigured" });
});
test("外部提供されたHTTPS API originと登録済profile IDを受理", () => {
  expect(
    readConnectionConfig({
      VITE_AUDIENCE_API_ORIGIN: "https://api.example.test",
      VITE_AUDIENCE_CAPABILITY_PROFILE_ID: "audience-png",
    }),
  ).toEqual({
    status: "configured",
    config: { apiOrigin: "https://api.example.test", capabilityProfileId: "audience-png" },
  });
});
test.each([
  { VITE_AUDIENCE_API_ORIGIN: "https://api.example.test" },
  {
    VITE_AUDIENCE_API_ORIGIN: "http://api.example.test",
    VITE_AUDIENCE_CAPABILITY_PROFILE_ID: "audience",
  },
  {
    VITE_AUDIENCE_API_ORIGIN: "https://api.example.test/path",
    VITE_AUDIENCE_CAPABILITY_PROFILE_ID: "audience",
  },
])("片側のみ・不正な設定を製品接続に使わない", (env) => {
  expect(readConnectionConfig(env)).toEqual({ status: "invalid" });
});
