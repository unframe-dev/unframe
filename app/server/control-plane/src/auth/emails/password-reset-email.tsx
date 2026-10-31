import { EmailLayout } from "./email-layout";

export function PasswordResetEmail({ url }: { url: string }) {
  return (
    <EmailLayout
      title="パスワードの再設定"
      preview="Unframe の新しいパスワードを設定してください。"
      description="ボタンから新しいパスワードを設定してください。"
      actionLabel="パスワードを再設定"
      url={url}
    />
  );
}
