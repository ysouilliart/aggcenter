"use client";

import { createTheme } from "@mui/material/styles";

/** Colors taken from the product screenshots used as the visual baseline. */
export const brand = {
  blue: "#1E88E5",
  blueDark: "#1565C0",
  blueLight: "#64B5F6",
  blueSoft: "#E3F2FD",
  orange: "#F57C00",
  orangeDark: "#E65100",
  ink: "#1B2430",
  muted: "#6B7280",
  line: "#E6EAF0",
  canvas: "#F4F6F8",
  paper: "#FFFFFF",
};

export const chartColors = {
  primary: brand.blue,
  primarySoft: brand.blueLight,
  warning: brand.orange,
  success: "#43A047",
  error: "#E53935",
  text: brand.ink,
  muted: brand.muted,
  grid: brand.line,
  track: "#EEF2F6",
};

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: {
      main: brand.blue,
      dark: brand.blueDark,
      light: brand.blueLight,
      contrastText: "#ffffff",
    },
    secondary: {
      main: brand.ink,
    },
    background: {
      default: brand.canvas,
      paper: brand.paper,
    },
    success: { main: "#2E7D32" },
    error: { main: "#E53935" },
    warning: { main: brand.orange, dark: brand.orangeDark, contrastText: "#ffffff" },
    info: { main: "#039BE5" },
    text: {
      primary: brand.ink,
      secondary: brand.muted,
    },
    divider: brand.line,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'var(--font-inter), "Inter", ui-sans-serif, system-ui, sans-serif',
    h1: { fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.02em" },
    h2: { fontSize: "1rem", fontWeight: 600, letterSpacing: "-0.01em" },
    subtitle1: { fontSize: "1rem", fontWeight: 600 },
    subtitle2: { fontSize: "0.8125rem", fontWeight: 600 },
    body1: { fontSize: "0.9375rem" },
    body2: { fontSize: "0.875rem" },
    caption: { fontSize: "0.75rem", color: brand.muted },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
    overline: {
      fontSize: "0.6875rem",
      fontWeight: 600,
      letterSpacing: "0.04em",
      textTransform: "none",
      color: brand.muted,
    },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8, paddingInline: 14 },
        contained: { boxShadow: "none" },
        text: { fontWeight: 600 },
      },
    },
    MuiTextField: {
      defaultProps: { variant: "outlined", size: "small" },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: { fontSize: 14, color: brand.muted },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 8, backgroundColor: brand.paper },
      },
    },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: {
          borderColor: brand.line,
          boxShadow: "none",
          borderRadius: 12,
        },
      },
    },
    MuiChip: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: { fontWeight: 600 },
        filled: { borderRadius: 999 },
        colorWarning: { fontWeight: 600 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 10 },
        colorInfo: { backgroundColor: brand.blueSoft, color: brand.ink },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          paddingInline: 12,
          border: 0,
          color: brand.muted,
          "&.Mui-selected": {
            color: brand.blueDark,
            backgroundColor: brand.blueSoft,
          },
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        grouped: {
          border: "0 !important",
          margin: 0,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontSize: 13,
          fontWeight: 600,
          textTransform: "none",
          letterSpacing: 0,
          color: brand.muted,
        },
        body: {
          fontSize: 13,
          color: brand.ink,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 500,
          minHeight: 36,
          fontSize: 13,
          color: brand.muted,
          "&.Mui-selected": { color: brand.blueDark, fontWeight: 600 },
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
  },
});
