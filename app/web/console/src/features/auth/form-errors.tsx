import styles from "@/shared/layouts/public-pages.module.css";

export function FormErrors({
  errors,
}: {
  errors: Record<string, { message?: string } | undefined>;
}) {
  const messages = Object.entries(errors).flatMap(([field, error]) =>
    error?.message ? [{ field, message: error.message }] : [],
  );
  return messages.length ? (
    <div role="alert" className={styles["error"]}>
      <p>入力内容を確認してください。</p>
      <ul>
        {messages.map(({ field, message }) => (
          <li id={`${field}-error`} key={field}>
            {message}
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}
