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
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'var(--font-inter), "Inter", ui-sans-serif, system-ui, sans-serif',
    fontWeightLight: 400,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    htmlFontSize: 16,
    fontSize: 13,
    h1: {
      fontSize: "1.25rem",
      fontWeight: 600,
      lineHeight: 1.3,
      letterSpacing: "-0.015em",
    },
    h2: {
      fontSize: "0.8125rem",
      fontWeight: 600,
      letterSpacing: 0,
      lineHeight: 1.4,
    },
    h5: {
      fontSize: "1.375rem",
      fontWeight: 500,
      letterSpacing: "-0.02em",
      lineHeight: 1.2,
    },
    subtitle1: { fontSize: "0.875rem", fontWeight: 500 },
    subtitle2: { fontSize: "0.8125rem", fontWeight: 500 },
    body1: { fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.5 },
    body2: { fontSize: "0.75rem", fontWeight: 400, lineHeight: 1.45 },
    caption: { fontSize: "0.6875rem", fontWeight: 400, color: brand.muted, lineHeight: 1.4 },
    button: { textTransform: "none", fontWeight: 500, letterSpacing: 0, fontSize: "0.8125rem" },
    overline: {
      fontSize: "0.6875rem",
      fontWeight: 400,
      letterSpacing: "0.02em",
      textTransform: "none",
      color: brand.muted,
      lineHeight: 1.3,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontWeight: 400,
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 6, paddingInline: 12, paddingBlock: 5, fontWeight: 500 },
        sizeSmall: { paddingInline: 10, paddingBlock: 4, fontSize: 12.5 },
        contained: { boxShadow: "none", fontWeight: 500 },
        text: { fontWeight: 500 },
      },
    },
    MuiTextField: {
      defaultProps: { variant: "outlined", size: "small" },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: { fontSize: 13, fontWeight: 400, color: brand.muted },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 8, backgroundColor: brand.paper },
        input: { fontSize: 13, fontWeight: 400 },
      },
    },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: {
          borderColor: brand.line,
          boxShadow: "none",
          borderRadius: 8,
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: "14px 16px",
          "&:last-child": { paddingBottom: 14 },
        },
      },
    },
    MuiChip: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: { fontWeight: 500, fontSize: 11, height: 20 },
        label: { paddingInline: 8 },
        filled: { borderRadius: 999 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8, padding: "6px 12px", fontSize: 13 },
        message: { padding: "4px 0", fontWeight: 400 },
        colorInfo: { backgroundColor: brand.blueSoft, color: brand.ink },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 400,
          fontSize: 13,
          paddingInline: 10,
          paddingBlock: 4,
          border: 0,
          color: brand.muted,
          "&.Mui-selected": {
            color: brand.ink,
            fontWeight: 500,
            backgroundColor: "transparent",
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
        root: { padding: "8px 16px" },
        head: {
          fontSize: 12,
          fontWeight: 500,
          textTransform: "none",
          letterSpacing: 0,
          color: brand.muted,
        },
        body: {
          fontSize: 13,
          fontWeight: 400,
          color: brand.ink,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 400,
          minHeight: 32,
          fontSize: 13,
          color: brand.muted,
          "&.Mui-selected": { color: brand.blueDark, fontWeight: 500 },
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: { minHeight: 32 },
      },
    },
  },
});
