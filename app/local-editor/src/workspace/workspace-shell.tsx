import { useEffect } from "react";
import { Modal } from "../ui/dialog";
import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceStatus } from "./workspace-status";
import { FlowTree } from "../flow/flow-tree";
import { PropsInspector } from "../project/props-inspector";
import { PreviewViewport } from "../preview/preview-viewport";
import { PlaybackControls } from "../preview/playback-controls";
import { TimelinePanel } from "../timeline/timeline-panel";
import { PublicationPanel } from "../publication/publication-panel";
import { DiagnosticsPanel } from "../diagnostics/diagnostics-panel";
import { StepTransitionGraph } from "../flow/step-transition-graph";
import { CueDetails } from "../flow/cue-details";
import { createTimelineView, cueDestination } from "../flow/flow-model";
import { Group, Panel, Separator, useDefaultLayout } from "../ui/resizable";
import { Tabs } from "../ui/tabs";
import { Button } from "../ui/button";
function Details() {
  const w = useWorkspace();
  const definition = useStore(w.project.store, (s) => s.project?.definition);
  const selection = useStore(w.ui, (s) => s.selection);
  const key = useStore(w.ui, (s) => s.key);
  const step =
    selection.groupId && selection.stepId
      ? definition?.flow.groups[selection.groupId]?.steps[selection.stepId]
      : null;
  const cue = step?.cues.find((c) => c.id === selection.cueId);
  return (
    <>
      <section className="inspector-section">
        <h2>詳細</h2>
        {key ? (
          <>
            <h3>
              {key.nodeId} / {key.property}
            </h3>
            <dl>
              <dt>Timeline</dt>
              <dd>{key.timelineId}</dd>
              <dt>Cue 発火から</dt>
              <dd>{key.time} ms</dd>
              <dt>値</dt>
              <dd>{key.value}</dd>
              <dt>Easing</dt>
              <dd>{key.easing}</dd>
            </dl>
            <Button onClick={() => w.ui.setState({ key: null })}>Cue の詳細へ</Button>
          </>
        ) : cue && definition && step ? (
          <CueDetails
            cue={cue}
            destination={cueDestination(definition, step.id, cue)}
            onSelectTimeline={() => w.ui.setState({ tab: "timeline" })}
          />
        ) : (
          <p className="muted">左の Cue または時間軸のキーを選択してください。</p>
        )}
      </section>
      {!w.readOnly && <PropsInspector />}
    </>
  );
}
function FlowGraph() {
  const w = useWorkspace();
  const definition = useStore(w.project.store, (s) => s.project?.definition);
  const selection = useStore(w.ui, (s) => s.selection);
  const group = definition
    ? createTimelineView(definition).groups.find((g) => g.id === selection.groupId)
    : null;
  return group ? (
    <div className="flow-graph-panel">
      <StepTransitionGraph
        group={group}
        selectedStepId={selection.stepId}
        onSelectStep={(stepId) => w.commands.selectFlow({ groupId: group.id, stepId, cueId: null })}
      />
    </div>
  ) : (
    <p className="empty-state">Group を選択してください。</p>
  );
}
function PreviewNotice() {
  const w = useWorkspace();
  const status = useStore(w.preview.store, (s) => s.status);
  if (status === "ready") return null;
  return (
    <div className="preview-notice" role="status">
      {status === "loading" ? (
        "Unity Preview を準備しています…"
      ) : status === "recovering" ? (
        "表示を復旧しています…"
      ) : status === "reload-required" || status === "error" ? (
        <>
          <span>表示を確認できません。</span>
          <Button onClick={() => w.commands.reloadPreview()}>Preview を再読込</Button>
        </>
      ) : (
        "Preview を待っています"
      )}
    </div>
  );
}
export function WorkspaceShell() {
  const w = useWorkspace();
  const compact = useStore(w.ui, (s) => s.compact);
  useEffect(() => {
    const media = matchMedia("(max-width: 900px)");
    const update = () =>
      w.ui.setState({
        compact: media.matches,
        ...(media.matches ? { leftOpen: false, rightOpen: false } : {}),
      });
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [w]);
  const left = useStore(w.ui, (s) => s.leftOpen);
  const right = useStore(w.ui, (s) => s.rightOpen);
  const tab = useStore(w.ui, (s) => s.tab);
  const columns = useDefaultLayout({
    id: "unframe.editor.columns",
    panelIds: [
      ...(left && !compact ? ["flow"] : []),
      "preview",
      ...(right && !compact ? ["inspector"] : []),
    ],
    onlySaveAfterUserInteractions: true,
  });
  const rows = useDefaultLayout({ id: "unframe.editor.rows", onlySaveAfterUserInteractions: true });
  return (
    <main className="workspace-shell">
      <WorkspaceHeader />
      <Group
        orientation="horizontal"
        id="workspace-columns"
        defaultLayout={columns.defaultLayout}
        onLayoutChanged={columns.onLayoutChanged}
        className="workspace-columns"
      >
        {left && !compact && (
          <>
            <Panel id="flow" defaultSize="20%" minSize="160px">
              <FlowTree />
            </Panel>
            <Separator className="resize-handle" />
          </>
        )}
        <Panel id="preview" minSize="280px">
          <Group
            orientation="vertical"
            className="preview-column"
            id="workspace-preview"
            defaultLayout={rows.defaultLayout}
            onLayoutChanged={rows.onLayoutChanged}
          >
            <Panel id="viewport" defaultSize="62%" minSize="180px">
              <div className="viewport-panel">
                <PreviewViewport />
                <PreviewNotice />
                <PlaybackControls />
              </div>
            </Panel>
            <Separator className="resize-handle" />
            <Panel id="bottom" minSize="150px">
              <Tabs.Root
                value={tab}
                onValueChange={(value) => w.ui.setState({ tab: value as typeof tab })}
                className="bottom-panel"
              >
                <Tabs.List className="panel-tabs" aria-label="下部パネル">
                  <Tabs.Tab value="timeline">時間軸</Tabs.Tab>
                  <Tabs.Tab value="flow">進行図</Tabs.Tab>
                  <Tabs.Tab value="diagnostics">問題</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="timeline">
                  <TimelinePanel />
                </Tabs.Panel>
                <Tabs.Panel value="flow">
                  <FlowGraph />
                </Tabs.Panel>
                <Tabs.Panel value="diagnostics">
                  <DiagnosticsPanel />
                </Tabs.Panel>
              </Tabs.Root>
            </Panel>
          </Group>
        </Panel>
        {right && !compact && (
          <>
            <Separator className="resize-handle" />
            <Panel id="inspector" defaultSize="25%" minSize="220px">
              <aside className="inspector" aria-label="詳細と Props">
                <Details />
              </aside>
            </Panel>
          </>
        )}
      </Group>
      {compact && (
        <>
          <Modal title="進行" open={left} onOpenChange={(leftOpen) => w.ui.setState({ leftOpen })}>
            <div className="compact-panel">
              <FlowTree />
            </div>
          </Modal>
          <Modal
            title="詳細と Props"
            open={right}
            onOpenChange={(rightOpen) => w.ui.setState({ rightOpen })}
          >
            <div className="compact-panel">
              <Details />
            </div>
          </Modal>
        </>
      )}
      <WorkspaceStatus />
      {!w.readOnly && <PublicationPanel />}
    </main>
  );
}
