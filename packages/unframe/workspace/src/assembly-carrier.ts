import type { ComponentLock, LockedSourceAsset } from "./project-inputs.js";
export type DeclarationProjectAssemblyCarrier = {
  readonly themeHashes: readonly { themeId: string; hash: string }[];
  readonly componentLocks: readonly ComponentLock[];
  readonly assets: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly mediaType: LockedSourceAsset["mediaType"];
        readonly checksum: string;
        readonly encodedSizeBytes: number;
      }
    >
  >;
};
