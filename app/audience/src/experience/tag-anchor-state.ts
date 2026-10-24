import type { BoardConfig } from "../fiducials/config";
import type { DetectorResult } from "../fiducials/detector";
import type { FiducialFrame } from "../fiducials/frame-source";
import { createTagLocalizationState, reduceTagLocalization } from "../fiducials/tag-localization";
import type { createLiveTagAnchor } from "../rendering/live-tag-anchor";

type AnchorRenderer = Pick<ReturnType<typeof createLiveTagAnchor>, "update">;

export function createTagAnchorState(config: BoardConfig) {
  const marker = config.markers[0]!;
  let tagLocalization = createTagLocalizationState();
  let anchor: {
    updateCount: number;
    lastTagAtMs: number | null;
    sdkFromVenue: number[] | null;
  } = { updateCount: 0, lastTagAtMs: null, sdkFromVenue: null };

  return {
    getSnapshot() {
      return { tagLocalization, anchor };
    },
    clear() {
      tagLocalization = createTagLocalizationState();
      anchor = { ...anchor, lastTagAtMs: null, sdkFromVenue: null };
    },
    observe(
      frame: FiducialFrame,
      result: DetectorResult,
      now: () => number,
      renderer: AnchorRenderer | null,
    ): boolean {
      tagLocalization = reduceTagLocalization(
        tagLocalization,
        {
          timestampMs: frame.timestampMs,
          intrinsics: frame.intrinsics,
          detections: result.detections,
        },
        {
          markerId: marker.id,
          sizeMeters: marker.sizeMeters,
          venueFromMarker: marker.venueFromMarker,
        },
      );
      if (
        renderer === null ||
        tagLocalization.status !== "tracked" ||
        tagLocalization.venueFromCamera === null ||
        frame.worldFromCamera === null ||
        !(now() - frame.timestampMs < 500)
      )
        return false;
      const sdkFromVenue = renderer.update(tagLocalization.venueFromCamera, frame.worldFromCamera);
      anchor = {
        updateCount: anchor.updateCount + 1,
        lastTagAtMs: frame.timestampMs,
        sdkFromVenue,
      };
      return true;
    },
  };
}
