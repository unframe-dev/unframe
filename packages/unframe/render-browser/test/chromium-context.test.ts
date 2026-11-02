import { describe, expect, it, vi } from "vitest";
import { createChromiumLease } from "../src/index.js";

describe("Chromium context lifecycle", () => {
  it("closes a context once on normal completion", async () => {
    const context = { close: vi.fn(async () => {}) };
    const lease = createChromiumLease(Promise.resolve(context));
    expect(await lease.ready).toBe(context);
    await Promise.all([lease.close(), lease.close()]);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("closes a context that arrives after cancellation", async () => {
    const context = { close: vi.fn(async () => {}) };
    let resolve!: (value: typeof context) => void;
    const lease = createChromiumLease(
      new Promise<typeof context>((done) => {
        resolve = done;
      }),
    );
    const closing = lease.close();
    resolve(context);
    await closing;
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("propagates context creation failure", async () => {
    const lease = createChromiumLease(Promise.reject(new Error("launch failed")));
    await expect(lease.ready).rejects.toThrow("launch failed");
    await expect(lease.close()).rejects.toThrow("launch failed");
  });
});
