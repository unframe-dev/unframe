import { ArrowLeftIcon, ArrowRightIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { browserDocumentStream } from "../../app/runtime/document-runtime";
import type { PresentationDocument } from "../../document/schema/presentation-document";
import { PresentationCanvas } from "../../viewer/presentation/presentation-canvas";
import { applyDocumentEvent, RevisionGapError } from "../../viewer/stream/document-event";
type ViewerSyncStatus = "waiting" | "receiving" | "resyncing" | "error";
export function ViewerPage({ document: initialDocument }: { document: PresentationDocument }) {
  const [document, setDocument] = useState(initialDocument);
  const [slide, setSlide] = useState(0);
  const [sync, setSync] = useState<ViewerSyncStatus>("waiting");
  useEffect(
    () =>
      browserDocumentStream.subscribe(document.id, (event) =>
        setDocument((current) => {
          try {
            setSync("receiving");
            return applyDocumentEvent(current, event);
          } catch (error) {
            if (error instanceof RevisionGapError) {
              setSync("resyncing");
              void browserDocumentStream
                .loadSnapshot(current.id)
                .then((snapshot) => {
                  setDocument(snapshot);
                  setSync("waiting");
                })
                .catch(() => setSync("error"));
              return current;
            }
            setSync("error");
            return current;
          }
        }),
      ),
    [document.id],
  );
  const active = document.slides[slide] ?? document.slides[0];
  const label =
    sync === "waiting"
      ? "確定操作を待機中"
      : sync === "receiving"
        ? "変更を反映しました"
        : sync === "resyncing"
          ? "Snapshotを再取得中"
          : "同期を再開できません";
  return (
    <main id="main-content" className="min-h-dvh bg-[#0b0e14] p-3 text-[#f8f8fb]">
      <div className="flex min-h-[calc(100dvh-24px)] flex-col gap-3">
        <header className="flex min-h-14 items-center gap-3 px-3">
          <div className="mr-auto min-w-0">
            <h1 className="truncate text-lg font-semibold">{document.metadata.title}</h1>
            <p className="text-xs text-white/65">Read-only viewer · revision {document.revision}</p>
          </div>
          <span className="hidden rounded-md border border-white/15 px-2 py-1 text-xs sm:inline">
            {label}
          </span>
          <Link
            to="/editor/$presentationId"
            params={{ presentationId: document.id }}
            search={{ panel: "properties" }}
          >
            <Button variant="ghost" className="text-white hover:bg-white/10">
              編集画面 <PencilSimpleIcon />
            </Button>
          </Link>
        </header>
        <section className="relative min-h-120 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#11151d]">
          {active && (
            <PresentationCanvas mode="viewer" document={document} activeSlideId={active.id} />
          )}
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 p-1">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10"
              aria-label="前のスライド"
              disabled={slide === 0}
              onClick={() => setSlide((i) => i - 1)}
            >
              <ArrowLeftIcon />
            </Button>
            <span className="min-w-16 text-center text-sm">
              {slide + 1} / {document.slides.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10"
              aria-label="次のスライド"
              disabled={slide >= document.slides.length - 1}
              onClick={() => setSlide((i) => i + 1)}
            >
              <ArrowRightIcon />
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
