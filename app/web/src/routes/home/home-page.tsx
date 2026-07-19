import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import ViewInArRounded from "@mui/icons-material/ViewInArRounded";
import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "../../app/brand/brand-mark";
import { brandColors } from "../../app/theme/theme";

export function HomePage() {
  return (
    <Box component="main" id="main-content" sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <Box
        component="header"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: { xs: 64, md: 72 },
          px: { xs: 2, md: 4 },
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          <BrandMark size={28} />
          <Typography sx={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.04em" }}>
            Unframe
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography color="text.secondary" sx={{ display: { xs: "none", sm: "block" }, fontSize: 12 }}>
            Workspace / Preview
          </Typography>
          <Chip label="Preview" size="small" variant="outlined" />
        </Stack>
      </Box>

      <Container maxWidth="xl" sx={{ py: { xs: 4, md: 7 }, px: { xs: 2, sm: 3, md: 4 } }}>
        <Stack spacing={{ xs: 4, md: 5 }}>
          <Box>
            <Typography
              variant="overline"
              sx={{ color: brandColors.purple, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em" }}
            >
              WORKSPACE / HOME
            </Typography>
            <Typography
              component="h1"
              variant="h1"
              sx={{ mt: 1, maxWidth: 720, fontSize: { xs: 34, md: 52 }, fontWeight: 650, lineHeight: 1.18 }}
            >
              空間を、プレゼンテーションに。
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: 600, lineHeight: 1.8 }}>
              作業中のプレゼンテーションを開き、3Dモデルとメッセージをひとつの資料として編集します。
            </Typography>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 300px" },
              gap: { xs: 2, md: 3 },
              alignItems: "start",
            }}
          >
            <Paper variant="outlined" sx={{ overflow: "hidden", bgcolor: "background.paper" }}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ px: { xs: 2, md: 3 }, py: 2.25, alignItems: { sm: "center" } }}
              >
                <Box
                  sx={{
                    display: "grid",
                    placeItems: "center",
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    borderRadius: 1.5,
                    color: brandColors.blue,
                    bgcolor: "rgba(113, 135, 245, 0.12)",
                  }}
                >
                  <ViewInArRounded />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography component="h2" sx={{ fontSize: 16, fontWeight: 650 }}>
                    最近のプレゼンテーション
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.25, fontSize: 12 }}>
                    1件のローカルプレビュー
                  </Typography>
                </Box>
              </Stack>
              <Divider />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ px: { xs: 2, md: 3 }, py: 2.5, alignItems: { sm: "center" } }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 650 }}>Spatial story</Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: 13 }}>
                    2 slides · GLB model · Revision 0
                  </Typography>
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

            <Paper variant="outlined" sx={{ p: 2.5, bgcolor: "background.paper" }}>
              <Typography variant="overline" sx={{ color: brandColors.purple, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em" }}>
                WORKSPACE STATUS
              </Typography>
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>同期</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>ブラウザ内共有</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>編集対象</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>2 slides</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>状態</Typography>
                  <Typography sx={{ color: "success.main", fontSize: 13, fontWeight: 600 }}>待機中</Typography>
                </Stack>
              </Stack>
            </Paper>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
