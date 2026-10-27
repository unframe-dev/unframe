export function admitPngMemory(
  assets: readonly { pixelSize: readonly [number, number]; encodedSizeBytes: number }[],
  residentCpuBytes: number,
  budgetBytes: number,
): number {
  if (
    !Number.isSafeInteger(residentCpuBytes) ||
    residentCpuBytes < 0 ||
    !Number.isSafeInteger(budgetBytes) ||
    budgetBytes <= 0
  )
    throw new Error("Invalid PNG CPU budget");
  let retainedCpuBytes = 0;
  for (const asset of assets) {
    const decodedBytes = asset.pixelSize[0] * asset.pixelSize[1] * 4;
    const peakBytes =
      residentCpuBytes + retainedCpuBytes + decodedBytes * 2 + asset.encodedSizeBytes;
    if (!Number.isSafeInteger(peakBytes) || peakBytes > budgetBytes)
      throw new Error("PNG replacement CPU budget exceeded");
    retainedCpuBytes += decodedBytes;
  }
  return retainedCpuBytes;
}
