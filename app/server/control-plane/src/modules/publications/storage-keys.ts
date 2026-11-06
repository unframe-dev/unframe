export const presentationBuildPrefix = (presentationId: string) =>
  `publication-builds/${presentationId}/`;

export const publicationAssetKey = (presentationId: string, buildId: string, assetId: string) =>
  `${presentationBuildPrefix(presentationId)}${buildId}/${assetId}`;
