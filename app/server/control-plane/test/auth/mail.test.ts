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
      ...(await verificationEmail("https://app.example.com/verify?token=one")),
    });
    await mail({
      to: "user@example.com",
      ...(await passwordResetEmail("https://app.example.com/reset?token=two")),
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer re_test_key" }),
      }),
    );
    const body = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({
      from: "auth@example.com",
      to: ["user@example.com"],
      subject: "Unframe のパスワードを再設定",
      html: expect.stringContaining("パスワードを再設定"),
      text: expect.stringContaining("https://app.example.com/reset?token=two"),
    });
    expect(body.html).toContain('href="https://app.example.com/reset?token=two"');
    expect(body.text).not.toMatch(/<[^>]+>/);
  });

  it("fails without exposing the Resend response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("secret", { status: 500 })),
    );
    const mail = createResendMailer("re_test_key", "auth@example.com");

    await expect(
      mail({
        to: "user@example.com",
        ...(await verificationEmail("https://app.example.com/verify")),
      }),
    ).rejects.toThrow("Resend rejected auth email with status 500");
  });

  it.each([
    {
      name: "verification",
      create: verificationEmail,
      title: "メールアドレスの確認",
      action: "メールアドレスを確認",
    },
    {
      name: "password reset",
      create: passwordResetEmail,
      title: "パスワードの再設定",
      action: "パスワードを再設定",
    },
  ])(
    "renders the $name email with one action and an intact text URL",
    async ({ create, title, action }) => {
      const url = `https://api.example.com/verify?token=${"a".repeat(300)}&callbackURL=https%3A%2F%2Fun-fra.me%2Flogin`;
      const message = await create(url);

      expect(message.html).toMatch(/<html\b[^>]*\blang="ja"/);
      expect(message.html).toContain(title);
      expect(message.html).toContain(action);
      expect(message.html).toContain(
        `href="https://api.example.com/verify?token=${"a".repeat(300)}&amp;callbackURL=https%3A%2F%2Fun-fra.me%2Flogin"`,
      );
      expect(message.html.match(/<a\b/g)).toHaveLength(1);
      expect(message.text).toContain(url);
      expect(message.text).toContain("Unframe");
      expect(message.text).not.toMatch(/<[^>]+>/);
    },
  );
});
