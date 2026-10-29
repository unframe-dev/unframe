import { createTheme, StyledEngineProvider, ThemeProvider } from "@mui/material/styles";
import type { ReactNode } from "react";

export const audienceTheme = createTheme({
  palette: {
    primary: { main: "#98444b", contrastText: "#ffffff" },
    secondary: { main: "#304bbd", contrastText: "#ffffff" },
    background: { default: "#ffffff", paper: "#f7f8fa" },
    text: { primary: "#17181c", secondary: "#555963" },
    error: { main: "#b3261e" },
  },
  typography: {
    fontFamily: 'Inter, "Noto Sans JP", ui-sans-serif, system-ui, sans-serif',
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 16 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 48, borderRadius: 24, paddingInline: 24 } },
    },
    MuiIconButton: { styleOverrides: { root: { width: 48, height: 48 } } },
    MuiDialog: { defaultProps: { transitionDuration: 0 } },
  },
});

export function AudienceTheme({ children }: { children: ReactNode }) {
  return (
    <StyledEngineProvider enableCssLayer>
      <ThemeProvider theme={audienceTheme}>{children}</ThemeProvider>
    </StyledEngineProvider>
  );
}
