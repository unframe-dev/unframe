import type { HostApi } from "../infra/host-api";
import type { PreviewDriver } from "../preview/preview-driver";
import { createPreviewController } from "../preview/preview-controller";
import { createPublicationController } from "../publication/publication-controller";
import { createProjectController } from "../project/project-controller";
import { createUiStore } from "./ui-store";
import { createCommands } from "./commands";
import type { Theme } from "../ui/theme";
export function createWorkspace({
  api,
  createDriver,
  theme = "light",
}: {
  api: HostApi;
  createDriver: (canvas: HTMLCanvasElement) => PreviewDriver;
  theme?: Theme;
}) {
  const ui = createUiStore(theme);
  let driver: PreviewDriver | null = null;
  let closed = false,
    started = false;
  let channel: "dev" | "dist" = "dev";
  let requestedRevision: string | null = null;
  let connected = false;
  const failureListeners = new Set<Parameters<PreviewDriver["subscribeFailure"]>[0]>();
  let unsubscribeDriver: (() => void) | undefined;
  const withDriver = () => {
    if (!driver) throw new Error("Preview canvas is not connected.");
    return driver;
  };
  const port: PreviewDriver = {
    prepare: (...args) => withDriver().prepare(...args),
    commit: (...args) => withDriver().commit(...args),
    playback: (...args) => withDriver().playback(...args),
    restore: (...args) => withDriver().restore(...args),
    discard: (...args) => driver?.discard(...args) ?? Promise.resolve(),
    invalidate: () => driver?.invalidate() ?? Promise.resolve(),
    subscribeFailure(listener) {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
    async dispose() {
      unsubscribeDriver?.();
      const current = driver;
      driver = null;
      await current?.dispose();
    },
  };
  function request() {
    const revision = project.store.getState().project?.revision;
    if (!closed && connected && revision) {
      requestedRevision = revision;
      preview.request(channel, revision);
    }
  }
  function update(revision: string) {
    if (channel === "dev" && revision !== requestedRevision) request();
  }
  const project = createProjectController({
    api,
    onSaved: (revision) => update(revision),
    onProject: (next) => {
      const selection = ui.getState().selection;
      const group = selection.groupId ? next.definition?.flow.groups[selection.groupId] : null;
      const step = selection.stepId ? group?.steps[selection.stepId] : null;
      const cue = step?.cues.find((c) => c.id === selection.cueId);
      if (!group || !step || (selection.cueId && !cue))
        ui.setState({
          selection: {
            groupId: group?.id ?? next.definition?.flow.initialGroupId ?? null,
            stepId: step?.id ?? null,
            cueId: cue?.id ?? null,
          },
          key: null,
        });
      const selectedKey = ui.getState().key;
      if (selectedKey) {
        const frame = cue?.actions.some(
          (action) =>
            action.kind === "timeline.play" && action.timelineId === selectedKey.timelineId,
        )
          ? next.definition?.flow.timelines[selectedKey.timelineId]?.tracks
              .find(
                (track) =>
                  track.target.nodeId === selectedKey.nodeId &&
                  track.target.property === selectedKey.property,
              )
              ?.keyframes.find((frame) => frame.timeMilliseconds === selectedKey.time)
          : undefined;
        ui.setState({
          key: frame
            ? {
                ...selectedKey,
                value: JSON.stringify(frame.value),
                easing: frame.easingToNext ?? "最終キー",
              }
            : null,
        });
      }
      update(next.revision);
    },
  });
  const preview = createPreviewController({
    api,
    driver: port,
    onRevision: (revision) => {
      requestedRevision = revision;
      project.rebaseRevision(revision);
    },
  });
  const publication = createPublicationController({
    api,
    onDistBuilt: () => {
      channel = "dist";
      request();
    },
  });
  const unsubscribe = preview.store.subscribe((next) => {
    publication.setReceipt(
      next.status === "ready" && next.loaded?.channel === "dist"
        ? { requestId: next.loaded.requestId, buildIdentity: next.loaded.buildIdentity }
        : null,
    );
  });
  const commands = createCommands({
    project,
    preview,
    publication,
    ui,
    selectChannel(next) {
      channel = next;
      request();
    },
    reload: request,
    async buildDist() {
      const revision = project.store.getState().project?.revision;
      if (!revision || project.store.getState().status !== "clean") return;
      channel = "dist";
      try {
        await preview.cancel();
      } catch {
        return;
      }
      await publication.build(revision);
    },
  });
  return {
    ui,
    project,
    preview,
    publication,
    commands,
    start() {
      if (closed || started) return;
      started = true;
      project.start();
      publication.start();
    },
    connectViewport(canvas: HTMLCanvasElement) {
      if (closed || connected) return;
      connected = true;
      driver = createDriver(canvas);
      unsubscribeDriver = driver.subscribeFailure((event) => {
        for (const listener of failureListeners) listener(event);
      });
      request();
    },
    dispose() {
      if (closed) return;
      closed = true;
      unsubscribe();
      project.dispose();
      publication.dispose();
      void preview.dispose().catch(() => undefined);
      failureListeners.clear();
    },
  };
}
export type Workspace = ReturnType<typeof createWorkspace>;
