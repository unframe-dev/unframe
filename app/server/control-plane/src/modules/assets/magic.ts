import type { AssetMediaType } from "./schema";

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((value, index) => bytes[index] === value);
const ascii = (value: string) => [...value].map((character) => character.charCodeAt(0));

export function matchesMagicBytes(mediaType: AssetMediaType, bytes: Uint8Array): boolean {
  switch (mediaType) {
    case "image/png":
      return startsWith(bytes, [0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return startsWith(bytes, ascii("RIFF")) && startsWith(bytes.slice(8), ascii("WEBP"));
    case "video/mp4":
      return startsWith(bytes.slice(4), ascii("ftyp"));
    case "audio/mpeg":
      return (
        startsWith(bytes, ascii("ID3")) ||
        (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe6) === 0xe2)
      );
    case "model/gltf-binary":
      return startsWith(bytes, [...ascii("glTF"), 2, 0, 0, 0]);
  }
}
