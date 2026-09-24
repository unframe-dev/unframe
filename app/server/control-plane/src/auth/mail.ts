type MailMessage = { to: string; subject: string; text: string };

export type AuthMailer = (message: MailMessage) => Promise<void>;

export function createResendMailer(apiKey: string, from: string): AuthMailer {
  return async ({ to, subject, text }) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
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
