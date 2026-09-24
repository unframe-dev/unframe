import { describe, expect, it } from "vitest";

describe("worker startup", () => {
  it("defers runtime binding validation until request handling", async () => {
    const worker = await import("../src/index");

    expect(worker.default).toMatchObject({
      fetch: expect.any(Function),
      scheduled: expect.any(Function),
    });
  });
});
