import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createPublicationAuth } from "../src/author/publication-auth.js";

describe("Host device authorization", () => {
  afterEach(() => vi.useRealTimers());

  it("polls on the Host without status reads and emits only changed public states", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const calls: string[] = [];
    const auth = createPublicationAuth({
      controlPlaneUrl: "https://api.example.com",
      webOrigin: "https://web.example.com",
      clientId: "editor",
      fetch: (async (url) => {
        calls.push(String(url));
        return Response.json(
          String(url).endsWith("/code")
            ? {
                device_code: "private-device",
                user_code: "code",
                expires_in: 60,
                interval: 3,
                verification_uri_complete: "https://web.example.com/device?user_code=code",
              }
            : { access_token: "private-bearer", token_type: "Bearer", expires_in: 10 },
        );
      }) as typeof fetch,
    });
    const changes: unknown[] = [];
    const unsubscribe = auth.subscribe((state) => changes.push(state));
    const otherChanges: unknown[] = [];
    auth.subscribe((state) => otherChanges.push(state));
    await auth.start();
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls).toHaveLength(1);
    expect(await auth.status()).toMatchObject({ status: "pending" });
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(await auth.status()).toEqual({ status: "authenticated", expiresAt: 14000 });
    expect(changes).toHaveLength(2);
    expect(JSON.stringify(changes)).not.toContain("private");
    await vi.advanceTimersByTimeAsync(10000);
    expect(changes.at(-1)).toEqual({ status: "expired" });
    expect(() => auth.credential()).toThrow();
    unsubscribe();
    auth.close();
    expect(changes).toHaveLength(3);
    expect(otherChanges).toHaveLength(4);
    expect(calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors slow_down, retries transport failures and stops at the pending deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const pollTimes: number[] = [];
    const auth = createPublicationAuth({
      controlPlaneUrl: "https://api.example.com",
      webOrigin: "https://web.example.com",
      clientId: "editor",
      fetch: (async (url) => {
        if (String(url).endsWith("/code"))
          return Response.json({
            device_code: "private-device",
            user_code: "code",
            expires_in: 20,
            interval: 1,
            verification_uri_complete: "https://web.example.com/device?user_code=code",
          });
        pollTimes.push(Date.now());
        if (pollTimes.length === 1) return Response.json({ error: "slow_down" }, { status: 400 });
        if (pollTimes.length === 2) throw new TypeError("network failed");
        if (pollTimes.length === 3) return Response.json({}, { status: 503 });
        return Response.json({ error: "authorization_pending" }, { status: 400 });
      }) as typeof fetch,
    });
    const changes: unknown[] = [];
    auth.subscribe((state) => changes.push(state));
    await auth.start();
    await vi.advanceTimersByTimeAsync(6999);
    expect(pollTimes).toEqual([1000]);
    await vi.advanceTimersByTimeAsync(13001);
    expect(pollTimes).toEqual([1000, 7000, 13000, 19000]);
    expect(changes).toHaveLength(2);
    expect(changes.at(-1)).toEqual({ status: "expired" });
    expect(vi.getTimerCount()).toBe(0);
    auth.close();
  });

  it("does not poll when status is read and releases timers on cancellation and close", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const paths: string[] = [];
    const auth = createPublicationAuth({
      controlPlaneUrl: "https://api.example.com",
      webOrigin: "https://web.example.com",
      clientId: "editor",
      fetch: (async (url) => {
        paths.push(String(url));
        return Response.json({
          device_code: "private",
          user_code: "code",
          expires_in: 60,
          interval: 1,
          verification_uri_complete: "https://web.example.com/device?user_code=code",
        });
      }) as typeof fetch,
    });
    await auth.start();
    vi.setSystemTime(5000);
    await auth.status();
    await auth.status();
    expect(paths).toHaveLength(1);
    auth.cancel();
    expect(vi.getTimerCount()).toBe(0);
    await auth.start();
    auth.close();
    await vi.advanceTimersByTimeAsync(60000);
    expect(paths).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps device and bearer credentials out of browser status, expires and cancels locally", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const calls: { path: string; body: unknown }[] = [];
    const auth = createPublicationAuth({
      controlPlaneUrl: "http://127.0.0.1:8787",
      webOrigin: "http://127.0.0.1:5173",
      clientId: "editor",
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
    await vi.advanceTimersByTimeAsync(3000);
    const status = await auth.status();
    expect(status).toEqual({ status: "authenticated", expiresAt: 14000 });
    expect(JSON.stringify(status)).not.toContain("private");
    expect(auth.credential()).toBe("private-bearer");
    await vi.advanceTimersByTimeAsync(10000);
    expect(await auth.status()).toEqual({ status: "expired" });
    expect(() => auth.credential()).toThrow();
    auth.cancel();
    expect(await auth.status()).toEqual({ status: "signed-out" });
  });

  it("rejects untrusted approval URLs and discards late successful polls after cancellation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let finish!: (response: Response) => void;
    const auth = createPublicationAuth({
      controlPlaneUrl: "https://api.example.com",
      webOrigin: "https://web.example.com",
      clientId: "editor",
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
    await vi.advanceTimersByTimeAsync(1000);
    auth.cancel();
    finish(Response.json({ access_token: "late-secret", token_type: "Bearer", expires_in: 600 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(await auth.status()).toEqual({ status: "signed-out" });
    expect(() => auth.credential()).toThrow();
    const unsafe = createPublicationAuth({
      controlPlaneUrl: "https://api.example.com",
      webOrigin: "https://web.example.com",
      clientId: "editor",
      fetch: Object.assign(
        async () =>
          Response.json({
            device_code: "secret",
            user_code: "code",
            expires_in: 60,
            interval: 1,
            verification_uri_complete: "https://evil.example.com/device?user_code=code",
          }),
        { preconnect: () => {} },
      ),
    });
    await expect(unsafe.start()).rejects.toThrow();
    expect(await unsafe.status()).toEqual({ status: "signed-out" });
  });

  it.each(["close", "expire"] as const)(
    "discards an outstanding token after %s",
    async (action) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      let finish!: (response: Response) => void;
      const auth = createPublicationAuth({
        controlPlaneUrl: "https://api.example.com",
        webOrigin: "https://web.example.com",
        clientId: "editor",
        fetch: (async (url) =>
          String(url).endsWith("/code")
            ? Response.json({
                device_code: "private-device",
                user_code: "code",
                expires_in: 2,
                interval: 1,
                verification_uri_complete: "https://web.example.com/device?user_code=code",
              })
            : new Promise<Response>((resolve) => {
                finish = resolve;
              })) as typeof fetch,
      });
      const changes: unknown[] = [];
      auth.subscribe((state) => changes.push(state));
      await auth.start();
      await vi.advanceTimersByTimeAsync(1000);
      if (action === "close") auth.close();
      else await vi.advanceTimersByTimeAsync(1000);
      finish(Response.json({ access_token: "late-secret", token_type: "Bearer", expires_in: 600 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(await auth.status()).toEqual({
        status: action === "close" ? "signed-out" : "expired",
      });
      expect(changes).toHaveLength(2);
      expect(() => auth.credential()).toThrow();
      expect(vi.getTimerCount()).toBe(0);
      auth.close();
    },
  );

  it("needs no configuration for local editing and never returns a secret in unconfigured status", async () => {
    const auth = createPublicationAuth();
    expect(await auth.status()).toEqual({ status: "unconfigured" });
    await expect(auth.start()).rejects.toThrow();
  });
});
