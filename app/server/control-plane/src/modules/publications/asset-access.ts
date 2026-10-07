import { canonicalizeJsonPayload } from "@unframe/unframe-core";

type AssetTarget = { presentationId: string; buildId: string; assetId: string };
const maximumLifetime = 5 * 60_000;

export class PublicationAssetAccess {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}

  private payload(target: AssetTarget, expires: number) {
    return new TextEncoder().encode(
      canonicalizeJsonPayload({
        purpose: "unframe:publication-asset-access:v1",
        ...target,
        expires,
      }),
    );
  }

  private key() {
    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }

  private validExpiry(expires: number) {
    const now = this.now();
    return Number.isSafeInteger(expires) && expires > now && expires <= now + maximumLifetime;
  }

  async issue(origin: string, target: AssetTarget, expires: number): Promise<string> {
    if (!this.validExpiry(expires)) throw new Error("Invalid asset capability expiry");
    const signature = [
      ...new Uint8Array(
        await crypto.subtle.sign("HMAC", await this.key(), this.payload(target, expires)),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const path = [target.presentationId, target.buildId, target.assetId]
      .map(encodeURIComponent)
      .join("/");
    return `${origin}/publication-assets/${path}?expires=${expires}&signature=${signature}`;
  }

  async verify(target: AssetTarget, expiresValue: string, signature: string): Promise<boolean> {
    const expires = Number(expiresValue);
    if (
      !/^[1-9][0-9]{0,15}$/.test(expiresValue) ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !this.validExpiry(expires)
    )
      return false;
    const bytes = Uint8Array.from(signature.match(/../g)!, (pair) => Number.parseInt(pair, 16));
    return crypto.subtle.verify("HMAC", await this.key(), bytes, this.payload(target, expires));
  }
}
