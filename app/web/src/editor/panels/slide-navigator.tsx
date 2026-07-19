import LayersRounded from "@mui/icons-material/LayersRounded";
import { Box, Divider, List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import { useEditorDocument } from "../document/editor-document-context";
import { useEditorSession } from "../session/editor-session-context";

export function SlideNavigator() {
  const { document } = useEditorDocument().history;
  const activeSlideId = useEditorSession((state) => state.activeSlideId);
  const selectedElementId = useEditorSession((state) => state.selectedElementId);
  const setActiveSlide = useEditorSession((state) => state.setActiveSlide);
  const selectElement = useEditorSession((state) => state.selectElement);

  return (
    <Box component="nav" aria-label="スライドと要素" sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ px: 2, py: 1.75, alignItems: "center" }}>
        <LayersRounded fontSize="small" color="action" />
        <Typography component="h2" variant="h2">
          スライド
        </Typography>
      </Stack>
      <Divider />
      <List disablePadding>
        {document.slides.map((slide, index) => (
          <Box key={slide.id}>
            <ListItemButton
              selected={slide.id === activeSlideId}
              onClick={() => setActiveSlide(slide.id)}
              sx={{ py: 1.5 }}
            >
              <ListItemText
                primary={`${String(index + 1).padStart(2, "0")}  ${slide.name}`}
                secondary={`${slide.elements.length} elements`}
                slotProps={{
                  primary: { sx: { fontWeight: 700, fontSize: 13 } },
                  secondary: { sx: { fontSize: 12 } },
                }}
              />
            </ListItemButton>
            {slide.id === activeSlideId && slide.elements.length > 0 ? (
              <List disablePadding sx={{ pb: 1 }}>
                {slide.elements.map((element) => (
                  <ListItemButton
                    key={element.id}
                    selected={element.id === selectedElementId}
                    onClick={() => selectElement(element.id)}
                    aria-label={`${element.name}を選択`}
                    sx={{ pl: 4, minHeight: 40 }}
                  >
                    <ListItemText
                      primary={element.name}
                      slotProps={{ primary: { sx: { fontSize: 13 } } }}
                    />
                  </ListItemButton>
                ))}
              </List>
            ) : null}
          </Box>
        ))}
      </List>
    </Box>
  );
}
