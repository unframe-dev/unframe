import { Box, Typography } from "@mui/material";
import type { PresentationDocument } from "../../document/schema/presentation-document";
import type { Transform } from "../../document/schema/transform";
import type { EditorTool, SnapSettings } from "../../editor/session/editor-session";

interface ViewerCanvasProps {
  mode: "viewer";
  document: PresentationDocument;
  activeSlideId: string;
}

interface EditorCanvasProps {
  mode: "editor";
  document: PresentationDocument;
  activeSlideId: string;
  selectedElementId: string | null;
  tool: EditorTool;
  showGrid: boolean;
  snap: SnapSettings;
  onSelect: (elementId: string | null) => void;
  onTransform: (elementId: string, transform: Transform) => void;
}

export type PresentationCanvasProps = ViewerCanvasProps | EditorCanvasProps;

export function PresentationCanvas({ document, activeSlideId }: PresentationCanvasProps) {
  const slide = document.slides.find((candidate) => candidate.id === activeSlideId);
  return (
    <Box
      aria-label="3Dプレゼンテーション"
      sx={{
        width: "100%",
        height: "100%",
        minHeight: 320,
        display: "grid",
        placeItems: "center",
        color: "#f8f8fb",
        bgcolor: "#171923",
      }}
    >
      <Typography>{slide?.name ?? "スライドが見つかりません"}</Typography>
    </Box>
  );
}
