import GridOnRounded from "@mui/icons-material/GridOnRounded";
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
import RedoRounded from "@mui/icons-material/RedoRounded";
import RotateRightRounded from "@mui/icons-material/RotateRightRounded";
import ScaleRounded from "@mui/icons-material/AspectRatioRounded";
import SelectAllRounded from "@mui/icons-material/SelectAllRounded";
import TranslateRounded from "@mui/icons-material/OpenWithRounded";
import UndoRounded from "@mui/icons-material/UndoRounded";
import {
  AppBar,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "../../app/brand/brand-mark";
import { brandColors } from "../../app/theme/theme";
import { useEditorDocument } from "../../editor/document/editor-document-context";
import { PropertiesPanel } from "../../editor/panels/properties-panel";
import { SlideNavigator } from "../../editor/panels/slide-navigator";
import { useEditorSession } from "../../editor/session/editor-session-context";
import type { EditorTool } from "../../editor/session/editor-session";
import { useEditorShortcuts } from "../../editor/shortcuts/use-editor-shortcuts";
import { EditorViewport } from "../../editor/viewport/editor-viewport";

const toolOptions: Array<{ value: EditorTool; label: string; icon: React.ReactNode }> = [
  { value: "select", label: "選択", icon: <SelectAllRounded /> },
  { value: "translate", label: "移動", icon: <TranslateRounded /> },
  { value: "rotate", label: "回転", icon: <RotateRightRounded /> },
  { value: "scale", label: "拡縮", icon: <ScaleRounded /> },
];

export function EditorShell({ presentationId }: { presentationId: string }) {
  const { history, syncStatus, undo, redo } = useEditorDocument();
  const tool = useEditorSession((state) => state.tool);
  const setTool = useEditorSession((state) => state.setTool);
  const showGrid = useEditorSession((state) => state.showGrid);
  const setShowGrid = useEditorSession((state) => state.setShowGrid);
  useEditorShortcuts();
  const syncLabel =
    syncStatus === "ready"
      ? "ブラウザ内共有: 待機中"
      : syncStatus === "publishing"
        ? "ブラウザ内共有: 反映中"
        : "ブラウザ内共有: 再試行が必要";

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <AppBar
        position="static"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "rgba(247, 247, 245, 0.92)",
          backdropFilter: "blur(18px)",
        }}
      >
        <Toolbar
          sx={{ gap: { xs: 1, md: 1.5 }, minHeight: { xs: 64, md: 72 }, px: { xs: 1.5, md: 3 } }}
        >
          <BrandMark size={30} />
          <Box sx={{ minWidth: 0, mr: "auto" }}>
            <Typography component="h1" variant="h1" noWrap>
              {history.document.metadata.title}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 11 }}>
              Revision {history.document.revision}
            </Typography>
          </Box>

          <Stack direction="row" spacing={0.25}>
            <Tooltip title="元に戻す">
              <span>
                <IconButton
                  aria-label="元に戻す"
                  disabled={history.undoStack.length === 0}
                  onClick={undo}
                >
                  <UndoRounded />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="やり直す">
              <span>
                <IconButton
                  aria-label="やり直す"
                  disabled={history.redoStack.length === 0}
                  onClick={redo}
                >
                  <RedoRounded />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <Divider orientation="vertical" flexItem />
          <ToggleButtonGroup
            exclusive
            size="small"
            value={tool}
            onChange={(_, value: EditorTool | null) => value && setTool(value)}
            aria-label="変形ツール"
            sx={{ display: { xs: "none", sm: "inline-flex" } }}
          >
            {toolOptions.map((option) => (
              <Tooltip title={option.label} key={option.value}>
                <ToggleButton value={option.value} aria-label={option.label}>
                  {option.icon}
                </ToggleButton>
              </Tooltip>
            ))}
          </ToggleButtonGroup>
          <Tooltip title={showGrid ? "グリッドを隠す" : "グリッドを表示"}>
            <IconButton
              aria-label={showGrid ? "グリッドを隠す" : "グリッドを表示"}
              onClick={() => setShowGrid(!showGrid)}
              color={showGrid ? "primary" : "default"}
            >
              <GridOnRounded />
            </IconButton>
          </Tooltip>
          <Chip
            size="small"
            label={syncLabel}
            color={syncStatus === "error" ? "error" : "default"}
            sx={{ display: { xs: "none", lg: "inline-flex" } }}
          />
          <Link
            to="/presentations/$presentationId/view"
            params={{ presentationId }}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "none" }}
          >
            <Button
              component="span"
              endIcon={<OpenInNewRounded />}
              variant="outlined"
              size="small"
              sx={{ borderColor: "rgba(21, 23, 29, 0.2)", color: "text.primary" }}
            >
              閲覧
            </Button>
          </Link>
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        id="main-content"
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 1fr) 300px" },
          gridTemplateRows: { xs: "auto minmax(420px, 1fr) auto", md: "calc(100dvh - 73px)" },
          gap: { xs: 1, md: 1.5 },
          p: { xs: 1, md: 1.5 },
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            overflow: "auto",
            borderRadius: 3,
            bgcolor: "rgba(255, 255, 255, 0.82)",
            boxShadow: "0 12px 32px rgba(21, 23, 29, 0.035)",
          }}
        >
          <SlideNavigator />
        </Paper>
        <Paper
          variant="outlined"
          sx={{
            minHeight: { xs: 420, md: 0 },
            overflow: "hidden",
            borderRadius: 3,
            bgcolor: brandColors.night,
            boxShadow: "0 18px 48px rgba(11, 14, 20, 0.12)",
          }}
        >
          <EditorViewport />
        </Paper>
        <Paper
          variant="outlined"
          sx={{
            overflow: "auto",
            borderRadius: 3,
            bgcolor: "rgba(255, 255, 255, 0.82)",
            boxShadow: "0 12px 32px rgba(21, 23, 29, 0.035)",
          }}
        >
          <PropertiesPanel />
        </Paper>
      </Box>
    </Box>
  );
}
