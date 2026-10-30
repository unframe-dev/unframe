import { createElement, type ReactElement } from "react";
import { render, toPlainText } from "react-email";
import { PasswordResetEmail } from "./emails/password-reset-email";
import { VerificationEmail } from "./emails/verification-email";

type MailMessage = { to: string; subject: string; html: string; text: string };

export type AuthMailer = (message: MailMessage) => Promise<void>;

export function createResendMailer(apiKey: string, from: string): AuthMailer {
  return async ({ to, subject, html, text }) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    if (!response.ok) {
      throw new Error(`Resend rejected auth email with status ${response.status}`);
    }
  };
}

async function renderMessage(
  subject: string,
  template: ReactElement,
): Promise<Omit<MailMessage, "to">> {
  const html = await render(template);
  return { subject, html, text: toPlainText(html) };
}

export const verificationEmail = (url: string) =>
  renderMessage("Unframe のメールアドレスを確認", createElement(VerificationEmail, { url }));

export const passwordResetEmail = (url: string) =>
  renderMessage("Unframe のパスワードを再設定", createElement(PasswordResetEmail, { url }));
