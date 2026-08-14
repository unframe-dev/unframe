import { describe, expect, it, vi } from "vitest";
import worker from "./index";

describe("worker", () => {
  it("passes the root-based request to Static Assets unchanged", async () => {
    const request = new Request("https://un-fra.me/editor/demo/preview?panel=properties", {
      headers: { "x-request-id": "request-1" },
    });
    const fetch = vi.fn().mockResolvedValue(new Response("asset"));
    const env = { ASSETS: { fetch } } as unknown as CloudflareBindings;
    const assetRequest = request as unknown as Parameters<typeof worker.fetch>[0];

    const response = await worker.fetch(assetRequest, env);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(assetRequest);
    expect(await response.text()).toBe("asset");
  });
});
