import { describe, expect, it } from "vitest";
import { createPublicationAuth } from "../src/author/publication-auth.js";

describe("Host device authorization", () => {
  it("keeps device and bearer credentials out of browser status, expires and cancels locally", async () => {
    let time = 1000;
    const calls: { path: string; body: unknown }[] = [];
    const auth = createPublicationAuth({
      controlPlaneUrl: "http://127.0.0.1:8787",
      webOrigin: "http://127.0.0.1:5173",
      clientId: "editor",
      now: () => time,
      fetch: (async (url, init) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, body: JSON.parse(String(init?.body)) });
        return Response.json(
          path.endsWith("/code")
            ? {
                device_code: "private-device",
                user_code: "USER-CODE",
                expires_in: 30,
                interval: 3,
                verification_uri_complete: "http://127.0.0.1:5173/device?user_code=USER-CODE",
              }
            : { access_token: "private-bearer", token_type: "Bearer", expires_in: 10 },
        );
      }) as typeof fetch,
    });
    expect(await auth.status()).toEqual({ status: "signed-out" });
    expect(await auth.start()).toEqual({
      status: "pending",
      userCode: "USER-CODE",
      verificationUrl: "http://127.0.0.1:5173/device?user_code=USER-CODE",
      expiresAt: 31000,
    });
    expect(await auth.status()).toMatchObject({ status: "pending" });
    expect(calls).toHaveLength(1);
    time += 3000;
    const status = await auth.status();
    expect(status).toEqual({ status: "authenticated", expiresAt: 14000 });
    expect(JSON.stringify(status)).not.toContain("private");
    expect(auth.credential()).toBe("private-bearer");
    time = 14000;
    expect(await auth.status()).toEqual({ status: "expired" });
    expect(() => auth.credential()).toThrow();
    auth.cancel();
    expect(await auth.status()).toEqual({ status: "signed-out" });
  });

  it("rejects untrusted approval URLs and discards late successful polls after cancellation", async () => {
    let time = 0;
    let finish!: (response: Response) => void;
    const auth = createPublicationAuth({
      controlPlaneUrl: "https://api.example.com",
      webOrigin: "https://web.example.com",
      clientId: "editor",
      now: () => time,
      fetch: (async (url) =>
        String(url).endsWith("/code")
          ? Response.json({
              device_code: "secret",
              user_code: "code",
              expires_in: 60,
              interval: 1,
              verification_uri_complete: "https://web.example.com/device?user_code=code",
            })
          : new Promise<Response>((resolve) => {
              finish = resolve;
            })) as typeof fetch,
    });
    await auth.start();
    time = 1000;
    const polling = auth.status();
    await Promise.resolve();
    auth.cancel();
    finish(Response.json({ access_token: "late-secret", token_type: "Bearer", expires_in: 600 }));
    expect(await polling).toEqual({ status: "signed-out" });
    expect(() => auth.credential()).toThrow();
    const unsafe = createPublicationAuth({
      controlPlaneUrl: "https://api.example.com",
      webOrigin: "https://web.example.com",
      clientId: "editor",
      fetch: (async () =>
        Response.json({
          device_code: "secret",
          user_code: "code",
          expires_in: 60,
          interval: 1,
          verification_uri_complete: "https://evil.example.com/device?user_code=code",
        })) as typeof fetch,
    });
    await expect(unsafe.start()).rejects.toThrow();
    expect(await unsafe.status()).toEqual({ status: "signed-out" });
  });

  it("needs no configuration for local editing and never returns a secret in unconfigured status", async () => {
    const auth = createPublicationAuth();
    expect(await auth.status()).toEqual({ status: "unconfigured" });
    await expect(auth.start()).rejects.toThrow();
  });
});
