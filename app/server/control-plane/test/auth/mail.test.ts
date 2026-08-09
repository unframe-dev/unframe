import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendMailer, passwordResetEmail, verificationEmail } from "../../src/auth/mail";

describe("Resend authentication mailer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends verification and password reset messages through Resend", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const mail = createResendMailer("re_test_key", "auth@example.com");

    await mail({
      to: "user@example.com",
      ...verificationEmail("https://app.example.com/verify?token=one"),
    });
    await mail({
      to: "user@example.com",
      ...passwordResetEmail("https://app.example.com/reset?token=two"),
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer re_test_key" }),
      }),
    );
  });

  it("fails without exposing the Resend response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("secret", { status: 500 })),
    );
    const mail = createResendMailer("re_test_key", "auth@example.com");

    await expect(
      mail({ to: "user@example.com", ...verificationEmail("https://app.example.com/verify") }),
    ).rejects.toThrow("Resend rejected auth email with status 500");
  });
});
