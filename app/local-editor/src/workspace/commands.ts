import type { FlowSelection, KeySelection } from "./ui-store";
import type { PlaybackIntent } from "../preview/playback-controller";
import type { createProjectController } from "../project/project-controller";
import type { createPreviewController } from "../preview/preview-controller";
import type { createPublicationController } from "../publication/publication-controller";
import type { createUiStore } from "./ui-store";
export function createCommands(input: {
  project: ReturnType<typeof createProjectController>;
  preview: ReturnType<typeof createPreviewController>;
  publication: ReturnType<typeof createPublicationController>;
  ui: ReturnType<typeof createUiStore>;
  selectChannel: (channel: "dev" | "dist") => void;
  reload: () => void;
  buildDist: () => Promise<void>;
}) {
  const available = () => input.preview.store.getState().status === "ready";
  const selectedInspection = () => {
    const p = input.preview.store.getState().playback;
    const selection = input.ui.getState().selection;
    return (
      p?.mode === "inspection" &&
      p.occurrences.some(
        (o) =>
          o.occurrenceId === p.inspection?.occurrenceId &&
          o.groupId === selection.groupId &&
          o.stepId === selection.stepId &&
          o.cueId === selection.cueId,
      )
    );
  };
  const consistent = () => {
    const p = input.project.store.getState().project;
    const view = input.preview.store.getState().loaded;
    return !!p && !!view?.sourceRevision && view.sourceRevision === p.revision;
  };
  return {
    saveProps: (propId: string) => input.project.saveProp(propId),
    undo: input.project.undo,
    redo: input.project.redo,
    selectPreviewChannel: input.selectChannel,
    reloadPreview: input.reload,
    buildDist: input.buildDist,
    selectFlow(selection: FlowSelection) {
      input.ui.setState({
        selection,
        key: null,
        ...(input.ui.getState().compact ? { leftOpen: false } : {}),
      });
    },
    selectKey(key: KeySelection) {
      input.ui.setState({ key });
      const response = input.preview.store.getState().playback;
      if (available() && consistent() && response?.mode === "inspection" && selectedInspection())
        input.preview.playback.seekCue(key.time);
    },
    playback(intent: PlaybackIntent) {
      if (available()) input.preview.playback.command(intent);
    },
    inspectCue() {
      if (!available() || !consistent()) return;
      const selection = input.ui.getState().selection;
      const occurrence = input.preview.store
        .getState()
        .playback?.occurrences.find(
          (item) =>
            item.groupId === selection.groupId &&
            item.stepId === selection.stepId &&
            item.cueId === selection.cueId,
        );
      if (occurrence) input.preview.playback.inspectCue(occurrence.occurrenceId);
    },
    seekCue(time: number) {
      if (available() && consistent() && selectedInspection()) input.preview.playback.seekCue(time);
    },
    leaveInspection() {
      if (available()) input.preview.playback.leaveInspection();
    },
    publish() {
      if (available()) return input.publication.publish();
      return Promise.resolve();
    },
  };
}
