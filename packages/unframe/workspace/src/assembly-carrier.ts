import type { UnframeLock } from "./lock.js";
export type DeclarationProjectAssemblyCarrier = {
  readonly themeHashes: UnframeLock["themeHashes"];
  readonly componentLocks: UnframeLock["componentLocks"];
  readonly assets: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly mediaType: UnframeLock["assets"][number]["mediaType"];
        readonly checksum: string;
        readonly encodedSizeBytes: number;
      }
    >
  >;
};
