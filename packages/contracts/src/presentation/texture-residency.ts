import { z } from "zod";

const uint64 = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u)
  .refine((value) => BigInt(value) <= (1n << 64n) - 1n);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u);
const planSchema = z.object({
  initialGroupId: id,
  textures: z
    .array(
      z.object({
        assetId: id,
        checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        pixelSize: z.object({ width: uint64, height: uint64 }),
        decodedGpuBytes: uint64,
        peakLoadCpuBytes: uint64,
      }),
    )
    .default([]),
  groupWindows: z.array(z.object({ groupId: id, assetIds: z.array(id).default([]) })).min(1),
  totalDecodedGpuBytes: uint64.default("0"),
  maximumPeakLoadCpuBytes: uint64.default("0"),
  maximumResidentGpuBytes: uint64.default("0"),
  maximumResidentTextureBindings: uint64.default("0"),
});

export function validateTextureResidencyPlan(value: unknown): void {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Texture residency plan is malformed");
  const plan = parsed.data;
  const sortedUnique = (values: string[]) =>
    values.every((item, i) => i === 0 || values[i - 1]! < item);
  if (
    !sortedUnique(plan.textures.map((texture) => texture.assetId)) ||
    !sortedUnique(plan.groupWindows.map((window) => window.groupId))
  ) {
    throw new TypeError("Texture residency entries must be sorted and unique");
  }
  const byAsset = new Map(plan.textures.map((texture) => [texture.assetId, texture]));
  const checksums = new Set<string>();
  let total = 0n;
  let maximumLoad = 0n;
  for (const texture of plan.textures) {
    const width = BigInt(texture.pixelSize.width),
      height = BigInt(texture.pixelSize.height);
    const gpu = BigInt(texture.decodedGpuBytes),
      cpu = BigInt(texture.peakLoadCpuBytes);
    if (
      checksums.has(texture.checksum) ||
      width === 0n ||
      height === 0n ||
      gpu !== width * height * 4n ||
      cpu === 0n
    )
      throw new TypeError("Texture residency descriptor is invalid");
    checksums.add(texture.checksum);
    total += gpu;
    if (cpu > maximumLoad) maximumLoad = cpu;
  }
  let maximumGpu = 0n;
  let maximumBindings = 0n;
  for (const window of plan.groupWindows) {
    if (!sortedUnique(window.assetIds))
      throw new TypeError("Texture residency window assets must be sorted and unique");
    let gpu = 0n;
    for (const id of window.assetIds) {
      const texture = byAsset.get(id);
      if (!texture) throw new TypeError("Texture residency window references an unknown asset");
      gpu += BigInt(texture.decodedGpuBytes);
    }
    if (gpu > maximumGpu) maximumGpu = gpu;
    if (BigInt(window.assetIds.length) > maximumBindings)
      maximumBindings = BigInt(window.assetIds.length);
  }
  if (
    !plan.groupWindows.some((window) => window.groupId === plan.initialGroupId) ||
    total !== BigInt(plan.totalDecodedGpuBytes) ||
    maximumLoad !== BigInt(plan.maximumPeakLoadCpuBytes) ||
    maximumGpu !== BigInt(plan.maximumResidentGpuBytes) ||
    maximumBindings !== BigInt(plan.maximumResidentTextureBindings)
  ) {
    throw new TypeError("Texture residency window aggregates are inconsistent");
  }
}
