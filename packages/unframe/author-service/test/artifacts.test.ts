import { expect, it } from "vitest";
import { collectAuthorArtifacts, readAuthorArtifacts, surfaceIdFor } from "../src/index.js";
import type { BuildArtifacts } from "@unframe/artifacts";

it("reads shared PNG bytes once and rejects output beyond the byte budget", async () => {
  const png = {
    kind: "baked-web",
    states: { a: { texture: { assetId: "image" } }, b: { texture: { assetId: "image" } } },
  };
  const artifacts = {
    renderBundle: {
      surfaces: { [surfaceIdFor("hero")]: { renderSurfaces: { main: { artifacts: { png } } } } },
    },
    assetSet: { assets: { image: { mediaType: "image/png", encodedSizeBytes: 3 } } },
  } as unknown as BuildArtifacts;
  let reads = 0;
  const readAsset = async () => {
    reads++;
    return { bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" };
  };
  const result = await collectAuthorArtifacts(artifacts, readAsset, ["hero"], 3);
  expect(result.catalog).toHaveLength(2);
  expect(reads).toBe(1);
  await expect(collectAuthorArtifacts(artifacts, readAsset, ["hero"], 2)).rejects.toThrow(
    RangeError,
  );
  expect(reads).toBe(1);
});

it("rejects an unsafe generation before attempting to read it", async () => {
  await expect(
    readAuthorArtifacts(
      "../unsafe",
      async () => {
        throw new Error("unexpected read");
      },
      [],
      10,
    ),
  ).rejects.toMatchObject({ code: "author-output-unsafe", status: 500 });
});
