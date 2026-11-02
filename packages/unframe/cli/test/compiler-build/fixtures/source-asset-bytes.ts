import type { CompilerSourceAssetBytes } from "@unframe/build";

const font = Uint8Array.of(0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

export const fixtureSourceAssetBytes = (input: unknown): CompilerSourceAssetBytes => {
  try {
    if (input === null || typeof input !== "object") return {};
    const assets = Object.getOwnPropertyDescriptor(input, "assets")?.value;
    if (assets === null || typeof assets !== "object") return {};
    return Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(assets)).map(([id, descriptor]) => {
        const asset = descriptor.value;
        const mediaType =
          asset && typeof asset === "object"
            ? Object.getOwnPropertyDescriptor(asset, "mediaType")?.value
            : undefined;
        return [id, (mediaType === "image/png" ? png : font).slice()];
      }),
    );
  } catch {
    return {};
  }
};
