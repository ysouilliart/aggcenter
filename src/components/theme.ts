"use client";

import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: {
      main: "#4f46e5",
      dark: "#4338ca",
      light: "#818cf8",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#0f172a",
    },
    background: {
      default: "#f6f7fb",
      paper: "#ffffff",
    },
    success: { main: "#059669" },
    error: { main: "#e11d48" },
    warning: { main: "#d97706" },
    info: { main: "#0284c7" },
    text: {
      primary: "#0f172a",
      secondary: "#64748b",
    },
    divider: "#e2e8f0",
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h1: { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.25 },
    h2: { fontSize: "1.05rem", fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: {
          boxShadow: "0 1px 2px rgb(15 23 42 / 0.05)",
        },
      },
    },
    MuiChip: {
      defaultProps: { size: "small" },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          paddingInline: 12,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontSize: 12,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "#64748b",
        },
      },
    },
  },
});
