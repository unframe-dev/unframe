type MailMessage = { subject: string; text: string; to: string };

export type AuthMailer = (message: MailMessage) => Promise<void>;

export function createResendMailer(apiKey: string, from: string): AuthMailer {
  return async ({ subject, text, to }) => {
    const response = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify({ from, subject, text, to: [to] }),
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Resend rejected auth email with status ${response.status}`);
    }
  };
}

export const verificationEmail = (url: string): Pick<MailMessage, "subject" | "text"> => ({
  subject: "Verify your Unframe email address",
  text: `Verify your email address to activate your Unframe account: ${url}`,
});

export const passwordResetEmail = (url: string): Pick<MailMessage, "subject" | "text"> => ({
  subject: "Reset your Unframe password",
  text: `Reset your Unframe password: ${url}`,
});
