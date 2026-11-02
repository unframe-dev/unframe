export const PROFILE_IMAGE_SIZE = 512;
export const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;

export function squareCrop(width: number, height: number, zoom: number, x: number, y: number) {
  const size = Math.min(width, height) / zoom;
  return { x: ((width - size) * (x + 1)) / 2, y: ((height - size) * (y + 1)) / 2, size };
}

export async function cropProfileImage(
  image: HTMLImageElement,
  zoom: number,
  x: number,
  y: number,
) {
  const crop = squareCrop(image.naturalWidth, image.naturalHeight, zoom, x, y);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PROFILE_IMAGE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を処理できませんでした。");
  context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("画像を処理できませんでした。"));
    }, "image/png");
  });
  if (blob.size > MAX_PROFILE_IMAGE_BYTES)
    throw new Error("画像の容量を小さくしてお試しください。");
  return blob;
}
