export const profileImageSizeLimit = 2 * 1024 * 1024;
const signature = [137, 80, 78, 71, 13, 10, 26, 10];

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

export async function isProfilePng(bytes: Uint8Array): Promise<boolean> {
  if (!signature.every((value, index) => bytes[index] === value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compressed: Uint8Array<ArrayBuffer>[] = [];
  let channels = 0;
  let ended = false;
  let dataEnded = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) return false;
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) return false;
    if (offset === 8) {
      if (kind !== "IHDR" || length !== 13) return false;
      if (view.getUint32(offset + 8) !== 512 || view.getUint32(offset + 12) !== 512) return false;
      const depth = bytes[offset + 16];
      const color = bytes[offset + 17];
      if (depth !== 8 || (color !== 2 && color !== 6)) return false;
      if (bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0)
        return false;
      channels = color === 6 ? 4 : 3;
    } else if (kind === "IDAT") {
      if (dataEnded) return false;
      compressed.push(bytes.slice(offset + 8, end - 4));
    } else if (kind === "IEND") {
      if (length !== 0 || end !== bytes.length || compressed.length === 0) return false;
      ended = true;
    } else {
      if (compressed.length) dataEnded = true;
      // Reject unknown critical chunks and animation; icons contain a single raster frame.
      if (kind === "acTL" || kind[0] === kind[0]?.toUpperCase()) return false;
    }
    offset = end;
  }
  if (!ended) return false;
  try {
    const reader = new Blob(compressed)
      .stream()
      .pipeThrough(new DecompressionStream("deflate"))
      .getReader();
    const rowLength = 512 * channels + 1;
    const expected = rowLength * 512;
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return total === expected;
      if (total + value.length > expected) {
        await reader.cancel();
        return false;
      }
      for (
        let index = (rowLength - (total % rowLength)) % rowLength;
        index < value.length;
        index += rowLength
      ) {
        if (value[index]! > 4) {
          await reader.cancel();
          return false;
        }
      }
      total += value.length;
    }
  } catch {
    return false;
  }
}
