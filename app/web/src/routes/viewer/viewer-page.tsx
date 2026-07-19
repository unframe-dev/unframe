import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import EditRounded from "@mui/icons-material/EditRounded";
import { Box, Button, Chip, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { brandColors } from "../../app/theme/theme";
import type { PresentationDocument } from "../../document/schema/presentation-document";
import { browserDocumentStream } from "../../app/runtime/document-runtime";
import { applyDocumentEvent, RevisionGapError } from "../../viewer/stream/document-event";
import { PresentationCanvas } from "../../viewer/presentation/presentation-canvas";

type ViewerSyncStatus = "waiting" | "receiving" | "resyncing" | "error";

export function ViewerPage({ document: initialDocument }: { document: PresentationDocument }) {
  const [document, setDocument] = useState(initialDocument);
  const [slideIndex, setSlideIndex] = useState(0);
  const [syncStatus, setSyncStatus] = useState<ViewerSyncStatus>("waiting");

  useEffect(
    () =>
      browserDocumentStream.subscribe(document.id, (event) => {
        setDocument((current) => {
          try {
            setSyncStatus("receiving");
            return applyDocumentEvent(current, event);
          } catch (error) {
            if (error instanceof RevisionGapError) {
              setSyncStatus("resyncing");
              void browserDocumentStream
                .loadSnapshot(current.id)
                .then((snapshot) => {
                  setDocument(snapshot);
                  setSyncStatus("waiting");
                })
                .catch(() => setSyncStatus("error"));
              return current;
            }
            setSyncStatus("error");
            return current;
          }
        });
      }),
    [document.id],
  );

  const activeSlide = document.slides[slideIndex] ?? document.slides[0];
  const statusLabel =
    syncStatus === "waiting"
      ? "確定操作を待機中"
      : syncStatus === "receiving"
        ? "変更を反映しました"
        : syncStatus === "resyncing"
          ? "Snapshotを再取得中"
          : "同期を再開できません";

  return (
    <Box
      component="main"
      id="main-content"
      sx={{
        minHeight: "100dvh",
        p: { xs: 1, md: 2 },
        bgcolor: brandColors.night,
        color: "#f8f8fb",
        backgroundImage: "radial-gradient(circle at 85% 0%, rgba(154, 128, 208, 0.16), transparent 32%)",
      }}
    >
      <Stack sx={{ minHeight: "calc(100dvh - 32px)" }} spacing={1}>
        <Stack
          component="header"
          direction="row"
          spacing={1.5}
          sx={{ px: { xs: 1, md: 2 }, minHeight: { xs: 56, md: 68 }, alignItems: "center" }}
        >
          <Box sx={{ mr: "auto", minWidth: 0 }}>
            <Typography component="h1" variant="h1" color="inherit" noWrap>
              {document.metadata.title}
            </Typography>
            <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,.64)" }}>
              Read-only viewer · revision {document.revision}
            </Typography>
          </Box>
          <Chip
            label={statusLabel}
            size="small"
            color={syncStatus === "error" ? "error" : "default"}
            sx={{ bgcolor: syncStatus === "error" ? undefined : "rgba(255,255,255,.08)", color: "inherit" }}
          />
          <Link
            to="/presentations/$presentationId/edit"
            params={{ presentationId: document.id }}
            search={{ panel: "properties" }}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <Button component="span" color="inherit" startIcon={<EditRounded />}>
              編集画面
            </Button>
          </Link>
        </Stack>
        <Paper
          sx={{
            position: "relative",
            flex: 1,
            minHeight: { xs: 480, md: 0 },
            overflow: "hidden",
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,.1)",
            bgcolor: brandColors.nightSoft,
            boxShadow: "0 20px 70px rgba(0,0,0,.24)",
          }}
        >
          {activeSlide ? (
            <PresentationCanvas mode="viewer" document={document} activeSlideId={activeSlide.id} />
          ) : null}
          <Stack
            direction="row"
            spacing={1}
            sx={{
              position: "absolute",
              left: "50%",
              bottom: 16,
              transform: "translateX(-50%)",
              alignItems: "center",
              px: 1,
              py: 0.5,
              borderRadius: 99,
              bgcolor: "rgba(12, 14, 20, 0.72)",
              color: "white",
            }}
          >
            <Tooltip title="前のスライド">
              <span>
                <IconButton
                  color="inherit"
                  aria-label="前のスライド"
                  disabled={slideIndex === 0}
                  onClick={() => setSlideIndex((index) => index - 1)}
                >
                  <ArrowBackRounded />
                </IconButton>
              </span>
            </Tooltip>
            <Typography sx={{ minWidth: 64, textAlign: "center", fontSize: 13 }}>
              {slideIndex + 1} / {document.slides.length}
            </Typography>
            <Tooltip title="次のスライド">
              <span>
                <IconButton
                  color="inherit"
                  aria-label="次のスライド"
                  disabled={slideIndex >= document.slides.length - 1}
                  onClick={() => setSlideIndex((index) => index + 1)}
                >
                  <ArrowForwardRounded />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
}
