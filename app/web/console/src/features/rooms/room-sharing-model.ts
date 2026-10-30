import { z } from "zod";
import { sessionJoinCodeSchema } from "@unframe/contracts/control-plane-http";
import encodeQR from "qr";

const audienceOriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash
  );
}, "Audience の接続先は HTTPS origin を指定してください。");

export function audienceJoinUrl(
  code: string,
  origin = import.meta.env["VITE_AUDIENCE_URL"] || "https://app.un-fra.me",
) {
  const url = new URL(audienceOriginSchema.parse(origin));
  url.hash = `join=${sessionJoinCodeSchema.parse(code)}`;
  return url.href;
}

export function invitationQr(url: string) {
  return encodeQR(url, "data-url", { border: 4, scale: 6 });
}
