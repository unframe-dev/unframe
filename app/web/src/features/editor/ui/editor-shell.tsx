import {
  ArrowsOutCardinalIcon,
  ArrowCounterClockwiseIcon,
  ArrowClockwiseIcon,
  BoundingBoxIcon,
  CursorClickIcon,
  GridFourIcon,
} from "@phosphor-icons/react";
import { BrandMark } from "@/shared/brand/brand-mark";
import { Button } from "@/shared/ui/button";
import { useEditorDocument } from "@/features/editor/model/editor-document-context";
import { PropertiesPanel } from "@/features/editor/ui/properties-panel";
import { SlideNavigator } from "@/features/editor/ui/slide-navigator";
import type { EditorTool } from "@/features/editor/model/editor-session";
import { useEditorSession } from "@/features/editor/model/editor-session-context";
import { useEditorShortcuts } from "@/features/editor/model/use-editor-shortcuts";
import { EditorViewport } from "@/features/editor/ui/editor-viewport";
const options: Array<{ value: EditorTool; label: string; icon: React.ReactNode }> = [
  { value: "select", label: "選択", icon: <CursorClickIcon /> },
  { value: "translate", label: "移動", icon: <ArrowsOutCardinalIcon /> },
  { value: "rotate", label: "回転", icon: <ArrowClockwiseIcon /> },
  { value: "scale", label: "拡縮", icon: <BoundingBoxIcon /> },
];
export function EditorShell() {
  const { history, syncStatus, undo, redo } = useEditorDocument();
  const tool = useEditorSession((s) => s.tool);
  const setTool = useEditorSession((s) => s.setTool);
  const grid = useEditorSession((s) => s.showGrid);
  const setGrid = useEditorSession((s) => s.setShowGrid);
  useEditorShortcuts();
  const sync =
    syncStatus === "ready"
      ? "ブラウザ保存: 保存済み"
      : syncStatus === "publishing"
        ? "ブラウザ保存: 保存中"
        : "ブラウザ保存: 再試行が必要";
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <header className="flex min-h-16 items-center gap-2 border-b bg-[#f7f7f5eb] px-3 backdrop-blur md:min-h-18 md:px-6">
        <BrandMark size={30} />
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-sm font-semibold">{history.document.metadata.title}</h1>
          <p className="text-xs text-[var(--muted)]">Revision {history.document.revision}</p>
        </div>
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            aria-label="元に戻す"
            title="元に戻す"
            disabled={!history.undoStack.length}
            onClick={undo}
          >
            <ArrowCounterClockwiseIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="やり直す"
            title="やり直す"
            disabled={!history.redoStack.length}
            onClick={redo}
          >
            <ArrowClockwiseIcon />
          </Button>
        </div>
        <div className="hidden border-l pl-2 sm:flex">
          {options.map((o) => (
            <Button
              key={o.value}
              variant={tool === o.value ? "outline" : "ghost"}
              size="icon"
              aria-label={o.label}
              title={o.label}
              onClick={() => setTool(o.value)}
            >
              {o.icon}
            </Button>
          ))}
        </div>
        <Button
          variant={grid ? "outline" : "ghost"}
          size="icon"
          aria-label={grid ? "グリッドを隠す" : "グリッドを表示"}
          title={grid ? "グリッドを隠す" : "グリッドを表示"}
          onClick={() => setGrid(!grid)}
        >
          <GridFourIcon />
        </Button>
        <span
          className={`hidden rounded-md border px-2 py-1 text-xs lg:inline ${syncStatus === "error" ? "border-[var(--destructive)]" : ""}`}
        >
          {sync}
        </span>
      </header>
      <main
        id="main-content"
        className="grid gap-3 p-3 md:h-[calc(100dvh-72px)] md:grid-cols-[220px_minmax(0,1fr)_300px]"
      >
        <section className="overflow-auto rounded-xl border bg-white/80 shadow-sm">
          <SlideNavigator />
        </section>
        <section className="min-h-[420px] overflow-hidden rounded-xl border bg-[#0b0e14] shadow-lg">
          <EditorViewport />
        </section>
        <section className="overflow-auto rounded-xl border bg-white/80 shadow-sm">
          <PropertiesPanel />
        </section>
      </main>
    </div>
  );
}
