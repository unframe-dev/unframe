declare module "js-aruco2/src/posit1.js" {
  interface PoseResult {
    bestRotation: number[][];
    bestTranslation: number[];
    alternativeRotation: number[][];
    alternativeTranslation: number[];
  }
  export const POS: {
    Posit: new (
      modelSize: number,
      focalLength: number,
    ) => {
      pose(corners: { x: number; y: number }[]): PoseResult;
    };
  };
}
