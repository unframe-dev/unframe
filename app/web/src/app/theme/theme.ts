import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#5b52f2", dark: "#4037c9", light: "#8c86ff" },
    secondary: { main: "#156b75" },
    background: { default: "#f3f4f8", paper: "#ffffff" },
    text: { primary: "#171923", secondary: "#626779" },
    divider: "#dfe1e8",
    success: { main: "#277a55" },
    warning: { main: "#9b6416" },
    error: { main: "#bd3348" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Inter, "Noto Sans JP", ui-sans-serif, system-ui, -apple-system, sans-serif',
    h1: { fontSize: "1.125rem", fontWeight: 700, lineHeight: 1.35 },
    h2: { fontSize: "0.875rem", fontWeight: 700, lineHeight: 1.45 },
    button: { textTransform: "none", fontWeight: 650 },
  },
  components: {
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          "&:focus-visible": {
            outline: "3px solid rgba(91, 82, 242, 0.42)",
            outlineOffset: 2,
          },
        },
      },
    },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
