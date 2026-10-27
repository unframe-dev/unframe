import { useStore } from "zustand";
import {
  SunIcon,
  MoonIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
  ArrowClockwiseIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useWorkspace } from "../app/workspace-provider";
import { Button } from "../ui/button";
import { saveTheme } from "../ui/theme";
export function WorkspaceHeader() {
  const w = useWorkspace();
  const theme = useStore(w.ui, (s) => s.theme);
  const project = useStore(w.project.store);
  const channel = useStore(w.preview.store, (s) => s.channel);
  return (
    <header className="workspace-header">
      <div className="brand">
        <span className="brand-mark">u</span>
        <h1>{w.readOnly ? "Unframe Dist Preview" : "Unframe"}</h1>
      </div>
      <div className="channel-switch" role="group" aria-label="Preview チャンネル">
        {!w.readOnly && (
          <Button
            aria-pressed={channel === "dev"}
            onClick={() => w.commands.selectPreviewChannel("dev")}
          >
            開発 Preview
          </Button>
        )}
        <Button
          aria-pressed={channel === "dist"}
          onClick={() => w.commands.selectPreviewChannel("dist")}
        >
          公開前確認
        </Button>
      </div>
      <div className="spacer" />
      {!w.readOnly && (
        <>
          <Button
            title="Undo"
            aria-label="Undo"
            disabled={project.status !== "clean" || !project.undo.length}
            onClick={() => void w.commands.undo()}
          >
            <ArrowUUpLeftIcon />
          </Button>
          <Button
            title="Redo"
            aria-label="Redo"
            disabled={project.status !== "clean" || !project.redo.length}
            onClick={() => void w.commands.redo()}
          >
            <ArrowUUpRightIcon />
          </Button>
        </>
      )}
      <Button
        title="Preview 再読込"
        aria-label="Preview 再読込"
        onClick={() => {
          void w.project.refresh();
          w.commands.reloadPreview();
        }}
      >
        <ArrowClockwiseIcon />
      </Button>
      <span className="header-divider" />
      <Button
        title="左パネル"
        aria-label="左パネルを開閉"
        aria-pressed={useStore(w.ui, (s) => s.leftOpen)}
        onClick={() =>
          w.ui.setState((s) => ({
            leftOpen: !s.leftOpen,
            ...(s.compact ? { rightOpen: false } : {}),
          }))
        }
      >
        <SidebarSimpleIcon />
      </Button>
      <Button
        title="右パネル"
        aria-label="右パネルを開閉"
        aria-pressed={useStore(w.ui, (s) => s.rightOpen)}
        onClick={() =>
          w.ui.setState((s) => ({
            rightOpen: !s.rightOpen,
            ...(s.compact ? { leftOpen: false } : {}),
          }))
        }
      >
        <SlidersHorizontalIcon />
      </Button>
      <Button
        aria-label={theme === "light" ? "ダークテーマに切り替え" : "ライトテーマに切り替え"}
        onClick={() => {
          const next = theme === "light" ? "dark" : "light";
          w.ui.setState({ theme: next });
          saveTheme(next);
        }}
      >
        {theme === "light" ? <MoonIcon /> : <SunIcon />}
      </Button>
      {!w.readOnly && (
        <Button className="primary" onClick={() => w.ui.setState({ publicationOpen: true })}>
          <UploadSimpleIcon />
          公開
        </Button>
      )}
    </header>
  );
}
