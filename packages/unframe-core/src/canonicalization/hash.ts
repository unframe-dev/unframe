import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const utf8Bytes = (value: string) => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    let codePoint = value.codePointAt(index)!;
    if (codePoint > 0xffff) index++;
    else if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff)
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    else
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
  }
  return Uint8Array.from(bytes);
};

export const hashCanonicalJson = (canonical: string) =>
  `sha256:${bytesToHex(sha256(utf8Bytes(canonical)))}`;
