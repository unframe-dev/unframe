export class ManagementError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(`Control Plane request failed (${status})`);
  }
}

export function managementErrorMessage(error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  switch (status) {
    case 401:
      return "ログインの有効期限が切れました。ログインし直してください。";
    case 403:
      return "この情報を参照・操作する権限がありません。";
    case 404:
      return "対象が見つからないか、参照できません。";
    case 409:
      return "公開済み Dist がないか、公開状態が変更されています。公開情報を再取得してください。";
    default:
      return "通信に失敗しました。時間をおいて再取得してください。";
  }
}

export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  action: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await action(values[index]!);
      }
    }),
  );
  return results;
}
