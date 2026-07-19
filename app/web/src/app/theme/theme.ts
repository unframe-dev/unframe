import { createTheme } from "@mui/material/styles";

export const brandColors = {
  background: "#f7f7f5",
  foreground: "#15171d",
  muted: "#747780",
  line: "#dedfe2",
  night: "#0b0e14",
  nightSoft: "#11151d",
  blue: "#7187f5",
  purple: "#9a80d0",
  red: "#df7b80",
} as const;

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: brandColors.blue, dark: "#5268d7", light: "#a9b5ff" },
    secondary: { main: brandColors.purple, dark: "#7862ad", light: "#c0afe7" },
    background: { default: brandColors.background, paper: "#ffffff" },
    text: { primary: brandColors.foreground, secondary: brandColors.muted },
    divider: brandColors.line,
    success: { main: "#4d8c70" },
    warning: { main: "#b68a4c" },
    error: { main: "#c86f77" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Inter, "Noto Sans JP", ui-sans-serif, system-ui, -apple-system, sans-serif',
    h1: { fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.035em" },
    h2: { fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.45, letterSpacing: "-0.025em" },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: "-0.01em" },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: brandColors.background,
          color: brandColors.foreground,
        },
      },
    },
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          "&:focus-visible": {
            outline: "3px solid rgba(113, 135, 245, 0.42)",
            outlineOffset: 2,
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 38,
          borderRadius: 8,
          boxShadow: "none",
          "&:hover": { boxShadow: "none" },
          "&.MuiButton-containedPrimary": {
            color: brandColors.night,
            background: brandColors.blue,
            "&:hover": { background: "#5268d7" },
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
        outlined: { borderColor: brandColors.line },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: brandColors.purple },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: brandColors.blue,
            borderWidth: 2,
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6, fontWeight: 600 },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderColor: brandColors.line,
          color: brandColors.muted,
          "&.Mui-selected": {
            color: brandColors.foreground,
            backgroundColor: "rgba(154, 128, 208, 0.14)",
            borderColor: "rgba(154, 128, 208, 0.38)",
          },
          "&.Mui-selected:hover": { backgroundColor: "rgba(154, 128, 208, 0.2)" },
        },
      },
    },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
