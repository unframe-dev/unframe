import { describe, expect, it } from "vitest";

describe("worker startup", () => {
  it("rejects invalid bindings while evaluating the entry module", async () => {
    await expect(import("../src/index")).rejects.toMatchObject({
      name: "ConfigurationError",
      fields: ["R2_ACCOUNT_ID"],
    });
  });
});
