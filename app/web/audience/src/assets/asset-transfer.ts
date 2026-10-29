interface TransferOptions {
  signal?: AbortSignal | undefined;
  fail(reason: string): never;
}

export async function receiveAssetBytes(
  response: Response,
  expectedSize: number,
  { signal, fail }: TransferOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) !== expectedSize) fail("encoded size mismatch");
  if (!response.body) return fail("response body missing");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(expectedSize);
  let length = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  const checkAbort = () => {
    if (signal?.aborted) fail("load aborted");
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      checkAbort();
      const chunk = await reader.read();
      checkAbort();
      if (chunk.done) break;
      if (length + chunk.value.length > expectedSize) fail("encoded size mismatch");
      bytes.set(chunk.value, length);
      length += chunk.value.length;
    }
    if (length !== expectedSize) fail("encoded size mismatch");
    return bytes;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function verifyAssetChecksum(
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
  fail: TransferOptions["fail"],
): Promise<void> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actual = `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  if (actual !== expected) fail("checksum mismatch");
}

export function assertDeliveryCurrent(
  expiresAtUnixMs: number,
  now: (() => number) | undefined,
  fail: TransferOptions["fail"],
): void {
  if (!Number.isFinite(expiresAtUnixMs) || expiresAtUnixMs <= (now ?? Date.now)())
    fail("delivery URL expired");
}
