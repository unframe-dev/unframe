import { AnchorExperienceView } from "./AnchorExperienceView";
import { useAnchorExperience } from "./use-anchor-experience";
import "../../styles.css";

export function AnchorExperience({
  viewerMode = false,
  onLeave,
}: { viewerMode?: boolean; onLeave?: () => void } = {}) {
  return (
    <AnchorExperienceView
      {...useAnchorExperience({
        showGuides: !viewerMode,
        mode: viewerMode ? "viewer" : "tracking",
      })}
      contentReady={!viewerMode}
      {...(onLeave ? { onLeave } : {})}
    />
  );
}
