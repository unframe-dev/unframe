import type { FlowSelection, KeySelection } from "./ui-store";
import type { PlaybackIntent } from "../preview/playback-controller";
import type { createProjectController } from "../project/project-controller";
import type { createPreviewController } from "../preview/preview-controller";
import type { createPublicationController } from "../publication/publication-controller";
import type { createUiStore } from "./ui-store";
export function createCommands(input: {
  readOnly?: boolean;
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
  const playFromStep = (groupId: string, stepId: string) => {
    const playback = input.preview.store.getState().playback;
    if (
      !available() ||
      !playback?.simulation?.steps.some(
        (step) => step.groupId === groupId && step.stepId === stepId,
      )
    )
      return;
    input.preview.playback.playFromStep(groupId, stepId);
  };
  return {
    saveProps: (propId: string) =>
      input.readOnly ? Promise.resolve() : input.project.saveProp(propId),
    undo: () => (input.readOnly ? Promise.resolve() : input.project.undo()),
    redo: () => (input.readOnly ? Promise.resolve() : input.project.redo()),
    selectPreviewChannel: input.selectChannel,
    reloadPreview: input.reload,
    previewView: input.preview.setView,
    resetPreviewCamera: input.preview.resetCamera,
    movePresenter: input.preview.movePresenter,
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
    playFromStep,
    playSelectedStep() {
      if (!consistent()) return;
      const { groupId, stepId } = input.ui.getState().selection;
      if (groupId && stepId) playFromStep(groupId, stepId);
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
      if (!input.readOnly && available()) return input.publication.publish();
      return Promise.resolve();
    },
  };
}
