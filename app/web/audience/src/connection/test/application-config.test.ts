import { expect, test } from "vitest";
import { createAudienceWebCapabilityProfile } from "@unframe/contracts/presentation";
import { readConnectionConfig } from "../application-config";

test("接続情報を仮の値で補わず設定待ちとする", () => {
  expect(readConnectionConfig({})).toEqual({ status: "unconfigured" });
});
test("HTTPS API originだけで実装に対応するprofileを使う", () => {
  expect(
    readConnectionConfig({
      VITE_AUDIENCE_API_ORIGIN: "https://api.example.test",
    }),
  ).toEqual({
    status: "configured",
    config: {
      apiOrigin: "https://api.example.test",
      capabilityProfileId: createAudienceWebCapabilityProfile().capabilityProfileId,
    },
  });
});
test.each([
  { VITE_AUDIENCE_API_ORIGIN: 123 },
  {
    VITE_AUDIENCE_API_ORIGIN: "http://api.example.test",
  },
  {
    VITE_AUDIENCE_API_ORIGIN: "https://api.example.test/path",
  },
])("不正なAPI originを製品接続に使わない", (env) => {
  expect(readConnectionConfig(env)).toEqual({ status: "invalid" });
});
