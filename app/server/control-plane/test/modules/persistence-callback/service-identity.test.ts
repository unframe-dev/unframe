import { describe, expect, it } from "vitest";

import { ServiceIdentity } from "../../../src/modules/persistence-callback/service-identity";

describe("ServiceIdentity", () => {
  it("accepts only the configured bearer secret", async () => {
    const identity = new ServiceIdentity("service-secret");

    await expect(
      identity.authenticate(
        new Request("https://example.test/callbacks/checkpoints", {
          headers: { authorization: "Bearer service-secret" },
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      identity.authenticate(
        new Request("https://example.test/callbacks/checkpoints", {
          headers: { authorization: "Bearer other-secret" },
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      identity.authenticate(new Request("https://example.test/callbacks/checkpoints")),
    ).resolves.toBe(false);
  });
});
