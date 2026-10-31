import { EmailLayout } from "./email-layout";

export function VerificationEmail({ url }: { url: string }) {
  return (
    <EmailLayout
      title="メールアドレスの確認"
      preview="メールアドレスを確認して、Unframe を始めましょう。"
      description="メールアドレスを確認すると、Unframe を利用できます。"
      actionLabel="メールアドレスを確認"
      url={url}
    />
  );
}
