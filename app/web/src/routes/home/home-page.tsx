import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import ViewInArRounded from "@mui/icons-material/ViewInArRounded";
import { Box, Button, Chip, Container, Paper, Stack, Typography } from "@mui/material";
import { Link } from "@tanstack/react-router";

export function HomePage() {
  return (
    <Box component="main" id="main-content" sx={{ minHeight: "100dvh", py: 8 }}>
      <Container maxWidth="lg">
        <Stack spacing={5}>
          <Stack spacing={2} sx={{ maxWidth: 760 }}>
            <Chip label="Web Editor preview" size="small" sx={{ alignSelf: "flex-start" }} />
            <Typography
              component="h1"
              variant="h2"
              sx={{ fontSize: { xs: 40, md: 64 }, letterSpacing: "-0.045em" }}
            >
              空間を、プレゼンテーションに。
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: { xs: 18, md: 22 }, maxWidth: 640 }}>
              3Dモデルとメッセージをひとつの資料にまとめ、編集結果を同じブラウザの閲覧画面へ共有します。
            </Typography>
          </Stack>

          <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, maxWidth: 760 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={3}
              sx={{ alignItems: { sm: "center" } }}
            >
              <Box
                sx={{
                  display: "grid",
                  placeItems: "center",
                  width: 72,
                  height: 72,
                  borderRadius: 3,
                  color: "primary.main",
                  bgcolor: "rgba(91, 82, 242, 0.08)",
                }}
              >
                <ViewInArRounded fontSize="large" />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography component="h2" variant="h6">
                  Spatial story
                </Typography>
                <Typography color="text.secondary">ローカルfixture・2 slides・GLB model</Typography>
              </Box>
              <Link
                to="/presentations/$presentationId/edit"
                params={{ presentationId: "demo" }}
                search={{ panel: "properties" }}
                style={{ textDecoration: "none" }}
              >
                <Button component="span" variant="contained" endIcon={<ArrowForwardRounded />}>
                  デモを編集
                </Button>
              </Link>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
