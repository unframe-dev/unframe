import { describe, expect, it, vi } from "vitest";
import { encodeWireMessage } from "@unframe/contracts/presentation";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import {
  AudienceConnectionError,
  createAudienceHttpClient,
  type Session,
  type Bootstrap,
} from "../http-client";

const config = { apiOrigin: "https://control.example", capabilityProfileId: "audience-png-v1" };
const now = Date.parse("2026-10-23T00:00:00Z");
const fence = {
  presentationId: "presentation",
  publicationEpoch: 1,
  publicationManifestHash: `sha256:${"a".repeat(64)}`,
};
const session: Session = {
  id: "session",
  presentationId: "presentation",
  presenterId: "presenter",
  state: "Presenting",
  participantCount: 2,
  maxParticipants: 50,
  createdAt: "2026-10-22T00:00:00Z",
  endedAt: null,
  publicationFence: fence,
};
const bootstrap: Bootstrap = {
  endpoint: "https://runtime.example/realtime",
  fingerprint: null,
  runtimeId: "runtime",
  runtimeKind: "Cloud",
  assignmentEpoch: 1,
  presentationId: "presentation",
  presentationRevision: 1,
  credential: "private-credential",
  expiresAt: "2026-10-23T00:05:00Z",
  publicationFence: fence,
  projectionProfileId: "projection",
};
function setup(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  return { fetch, client: createAudienceHttpClient(config, { fetch, now: () => now }) };
}

describe("Audience HTTP client", () => {
  it("posts join with existing cookie identity and validates the session", async () => {
    const { client, fetch } = setup(Response.json(session));
    expect(await client.join("ABCD-EFGH")).toEqual(session);
    expect(fetch).toHaveBeenCalledWith(
      "https://control.example/sessions/join",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        body: JSON.stringify({ joinCode: "ABCD-EFGH" }),
      }),
    );
  });
  it("posts the selected capability and decodes contract protobuf", async () => {
    const value = structuredClone(fixture.value);
    const bytes = encodeWireMessage("unframe.delivery.DeliveryManifest", value);
    const { client, fetch } = setup(
      new Response(new Uint8Array(bytes), {
        headers: { "content-type": "application/x-protobuf" },
      }),
    );
    expect((await client.delivery(value.sessionId)).sessionId).toBe(value.sessionId);
    expect(fetch).toHaveBeenCalledWith(
      `https://control.example/sessions/${value.sessionId}/delivery`,
      expect.objectContaining({
        body: JSON.stringify({ capabilityProfileId: config.capabilityProfileId }),
      }),
    );
  });
  it("retrieves bootstrap without inventing a request body", async () => {
    const { client, fetch } = setup(Response.json(bootstrap));
    expect(await client.bootstrap("session")).toEqual(bootstrap);
    expect(fetch).toHaveBeenCalledWith(
      "https://control.example/sessions/session/bootstrap",
      expect.not.objectContaining({ body: expect.anything() }),
    );
  });
  it.each([
    "http://control.example",
    "https://u:p@control.example",
    "https://control.example/path",
    "https://control.example?token=x",
    "https://control.example#x",
    "not-url",
  ])("rejects unsafe API origin %s", (apiOrigin) => {
    expect(() => createAudienceHttpClient({ ...config, apiOrigin })).toThrow(
      AudienceConnectionError,
    );
  });
  it("validates inputs before sending requests", async () => {
    const { client, fetch } = setup(Response.json(session));
    await expect(client.join("INVALID")).rejects.toMatchObject({ code: "invalid-join-code" });
    await expect(client.bootstrap("../session")).rejects.toMatchObject({
      code: "invalid-session-id",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 422, 429, 503])(
    "returns safe typed errors for HTTP %s",
    async (status) => {
      const { client } = setup(
        new Response("private-credential https://secret.example", { status }),
      );
      const error = await client.join("ABCD-EFGH").catch((value: unknown) => value);
      expect(error).toMatchObject({ code: "http-error", status });
      expect(String(error)).not.toContain("private-credential");
    },
  );
  it.each([
    new Response("{}", { headers: { "content-type": "text/html" } }),
    Response.json({}),
    new Response("{", { headers: { "content-type": "application/json" } }),
  ])("rejects malformed JSON responses", async (response) => {
    const { client } = setup(response);
    await expect(client.join("ABCD-EFGH")).rejects.toMatchObject({ code: "invalid-response" });
  });
  it("rejects unsafe bootstrap endpoints and inconsistent publication identity", async () => {
    for (const value of [
      { ...bootstrap, endpoint: "https://user:pass@runtime.example" },
      { ...bootstrap, endpoint: "http://runtime.example" },
      { ...bootstrap, publicationFence: { ...fence, presentationId: "other" } },
    ]) {
      const { client } = setup(Response.json(value));
      await expect(client.bootstrap("session")).rejects.toMatchObject({ code: "invalid-response" });
    }
  });
  it("rejects expired bootstrap credentials", async () => {
    const { client } = setup(
      Response.json({ ...bootstrap, expiresAt: new Date(now).toISOString() }),
    );
    await expect(client.bootstrap("session")).rejects.toMatchObject({ code: "expired-bootstrap" });
  });
  it("rejects missing or mismatched Delivery identity", async () => {
    for (const bytes of [
      new Uint8Array(),
      encodeWireMessage("unframe.delivery.DeliveryManifest", fixture.value),
    ]) {
      const { client } = setup(
        new Response(new Uint8Array(bytes), {
          headers: { "content-type": "application/x-protobuf" },
        }),
      );
      await expect(client.delivery("different-session")).rejects.toMatchObject({
        code: "invalid-response",
      });
    }
  });
  it("rejects unsupported Delivery contract versions", async () => {
    const value = fixture.value;
    const bytes = new Uint8Array(encodeWireMessage("unframe.delivery.DeliveryManifest", value));
    // Delivery field 2 is the contract major; mutate wire bytes because the encoder rejects obsolete majors.
    const marker = bytes.findIndex((byte, index) => byte === 16 && bytes[index + 1] === 3);
    expect(marker).toBeGreaterThan(-1);
    bytes[marker + 1] = 1;
    const { client } = setup(
      new Response(bytes, {
        headers: { "content-type": "application/x-protobuf" },
      }),
    );
    await expect(client.delivery(value.sessionId)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
  it("honors cancellation while protobuf response data is being read", async () => {
    const abort = new AbortController();
    const response = new Response(
      new Uint8Array(encodeWireMessage("unframe.delivery.DeliveryManifest", fixture.value)),
      { headers: { "content-type": "application/x-protobuf" } },
    );
    vi.spyOn(response, "arrayBuffer").mockImplementation(async () => {
      abort.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const { client } = setup(response);
    await expect(client.delivery(fixture.value.sessionId, abort.signal)).rejects.toMatchObject({
      code: "aborted",
    });
  });
  it("honors cancellation while JSON response data is being read", async () => {
    const abort = new AbortController();
    const response = Response.json(session);
    vi.spyOn(response, "json").mockImplementation(async () => {
      abort.abort();
      return session;
    });
    const { client } = setup(response);
    await expect(client.join("ABCD-EFGH", abort.signal)).rejects.toMatchObject({ code: "aborted" });
  });
  it("forwards abort and hides network error details", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("secret"));
    const client = createAudienceHttpClient(config, { fetch });
    await expect(client.join("ABCD-EFGH")).rejects.toMatchObject({
      code: "network-error",
      message: "network-error",
    });
    const abort = new AbortController();
    abort.abort();
    await expect(client.join("ABCD-EFGH", abort.signal)).rejects.toMatchObject({ code: "aborted" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
