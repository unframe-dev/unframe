import { contentHashSchema, safeUIntSchema } from "@unframe/contracts/presentation";
import { z } from "zod";
import { getAssetFailure, type AssetFailureDetails } from "../diagnostics/asset-failure";
export type AssetFailureReporter = (
  reason: string,
  details?: Omit<AssetFailureDetails, "kind">,
) => never;

interface EncodedAsset {
  url: string;
  expiresAtUnixMs: number;
  encodedSizeBytes: number;
  checksum: string;
}
interface AssetRequestOptions {
  signal?: AbortSignal | undefined;
  fetcher?: typeof fetch;
  now?: () => number;
}
const encodedAssetSchema = z.object({
  encodedSizeBytes: safeUIntSchema,
  checksum: contentHashSchema,
});
const deliveryUrlSchema = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password;
});

export function assertAssetCurrent(
  asset: EncodedAsset,
  options: AssetRequestOptions,
  fail: TransferOptions["fail"],
  stage: AssetFailureDetails["stage"] = "validation",
): void {
  if (options.signal?.aborted) fail("load aborted", { stage, code: "aborted" });
  assertDeliveryCurrent(asset.expiresAtUnixMs, options.now, fail, stage);
}

export async function requestAssetBytes(
  asset: EncodedAsset,
  options: AssetRequestOptions,
  format: {
    mimeType: string;
    minBytes: number;
    fail: TransferOptions["fail"];
  },
): Promise<Uint8Array<ArrayBuffer>> {
  const { fail } = format;
  const checkCurrent = () => assertAssetCurrent(asset, options, fail);
  checkCurrent();
  if (!deliveryUrlSchema.safeParse(asset.url).success)
    fail("URL must use HTTPS without credentials", { stage: "validation", code: "invalid-url" });
  if (!encodedAssetSchema.safeParse(asset).success || asset.encodedSizeBytes < format.minBytes)
    fail("invalid metadata", { stage: "validation", code: "invalid-metadata" });
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(asset.url, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return fail("load failed", {
      stage: "request",
      code: options.signal?.aborted ? "aborted" : "network-error",
    });
  }
  const responseFailure: AssetFailureReporter = (reason, details) =>
    fail(reason, {
      stage: "response",
      code: "network-error",
      ...details,
      httpStatus: response.status,
    });
  const checkResponseCurrent = () =>
    assertAssetCurrent(asset, options, responseFailure, "response");
  try {
    checkResponseCurrent();
    if (!response.ok) responseFailure("request failed", { stage: "response", code: "http-error" });
    if (
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      format.mimeType
    )
      responseFailure("content type required", { stage: "response", code: "mime-mismatch" });
    return await receiveAssetBytes(response, asset.encodedSizeBytes, {
      signal: options.signal,
      fail: responseFailure,
      checkCurrent: checkResponseCurrent,
    });
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    if (getAssetFailure(error)) throw error;
    responseFailure("response read failed", {
      stage: "response",
      code: options.signal?.aborted ? "aborted" : "network-error",
    });
  }
}

interface TransferOptions {
  signal?: AbortSignal | undefined;
  fail: AssetFailureReporter;
  checkCurrent(): void;
}

async function receiveAssetBytes(
  response: Response,
  expectedSize: number,
  { signal, fail, checkCurrent }: TransferOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body)
    return fail("response body missing", { stage: "response", code: "body-missing" });
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const declared = response.headers.get("content-length");
    if (declared !== null && Number(declared) !== expectedSize)
      fail("encoded size mismatch", { stage: "response", code: "size-mismatch" });
    const bytes = new Uint8Array(expectedSize);
    let length = 0;
    for (;;) {
      checkCurrent();
      const chunk = await reader.read();
      checkCurrent();
      if (chunk.done) break;
      if (length + chunk.value.length > expectedSize)
        fail("encoded size mismatch", { stage: "response", code: "size-mismatch" });
      bytes.set(chunk.value, length);
      length += chunk.value.length;
    }
    if (length !== expectedSize)
      fail("encoded size mismatch", { stage: "response", code: "size-mismatch" });
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
  if (actual !== expected)
    fail("checksum mismatch", { stage: "checksum", code: "checksum-mismatch" });
}

function assertDeliveryCurrent(
  expiresAtUnixMs: number,
  now: (() => number) | undefined,
  fail: TransferOptions["fail"],
  stage: AssetFailureDetails["stage"] = "validation",
): void {
  if (!Number.isFinite(expiresAtUnixMs) || expiresAtUnixMs <= (now ?? Date.now)())
    fail("delivery URL expired", { stage, code: "expired" });
}
