"use client";

import AccountBalanceWalletOutlined from "@mui/icons-material/AccountBalanceWalletOutlined";
import BadgeOutlined from "@mui/icons-material/BadgeOutlined";
import CompareArrowsOutlined from "@mui/icons-material/CompareArrowsOutlined";
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined";
import FactCheckOutlined from "@mui/icons-material/FactCheckOutlined";
import FolderOutlined from "@mui/icons-material/FolderOutlined";
import FormatListBulletedOutlined from "@mui/icons-material/FormatListBulletedOutlined";
import HistoryOutlined from "@mui/icons-material/HistoryOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import InboxOutlined from "@mui/icons-material/InboxOutlined";
import InsightsOutlined from "@mui/icons-material/InsightsOutlined";
import IosShareOutlined from "@mui/icons-material/IosShareOutlined";
import ReportProblemOutlined from "@mui/icons-material/ReportProblemOutlined";
import ShowChartOutlined from "@mui/icons-material/ShowChartOutlined";
import WarningAmberOutlined from "@mui/icons-material/WarningAmberOutlined";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Toolbar from "@mui/material/Toolbar";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { prefetchFetch } from "@/lib/useFetch";

type WorkspaceId = "cash" | "suppliers" | "invoices" | "people";

const DRAWER_WIDTH = 256;

const WORKSPACES: { id: WorkspaceId; label: string; home: string; hint: string }[] = [
  { id: "cash", label: "Cash", home: "/", hint: "O2C & P2P" },
  { id: "suppliers", label: "Suppliers", home: "/suppliers", hint: "Master data" },
  { id: "invoices", label: "Invoices", home: "/invoices", hint: "AP parser" },
  { id: "people", label: "People", home: "/people-docs", hint: "HR agreements" },
];

const NAV: Record<
  WorkspaceId,
  { href: string; label: string; icon: ReactNode }[]
> = {
  cash: [
    { href: "/", label: "Cash Position", icon: <AccountBalanceWalletOutlined fontSize="small" /> },
    { href: "/forecast", label: "Forecast", icon: <ShowChartOutlined fontSize="small" /> },
    { href: "/reconciliation", label: "Reconciliation", icon: <CompareArrowsOutlined fontSize="small" /> },
    { href: "/anomalies", label: "Anomalies", icon: <WarningAmberOutlined fontSize="small" /> },
    { href: "/statements", label: "Statements", icon: <DescriptionOutlined fontSize="small" /> },
  ],
  suppliers: [
    { href: "/suppliers", label: "Overview", icon: <InsightsOutlined fontSize="small" /> },
    { href: "/suppliers/records", label: "Records", icon: <FormatListBulletedOutlined fontSize="small" /> },
    { href: "/suppliers/review", label: "Review", icon: <FactCheckOutlined fontSize="small" /> },
    { href: "/suppliers/audit", label: "Audit", icon: <HistoryOutlined fontSize="small" /> },
    { href: "/suppliers/fbdi", label: "FBDI", icon: <IosShareOutlined fontSize="small" /> },
  ],
  invoices: [
    { href: "/invoices", label: "Inbox", icon: <InboxOutlined fontSize="small" /> },
    { href: "/invoices/anomalies", label: "Needs review", icon: <ReportProblemOutlined fontSize="small" /> },
  ],
  people: [
    { href: "/people-docs", label: "People docs", icon: <BadgeOutlined fontSize="small" /> },
  ],
};

const SHARED = [
  { href: "/files", label: "Files", icon: <FolderOutlined fontSize="small" /> },
  { href: "/integrations", label: "Integrations", icon: <HubOutlined fontSize="small" /> },
];

const PREFETCH_APIS: Record<string, string[]> = {
  "/": ["/api/cash-position", "/api/cash-forecast?summary=1"],
  "/forecast": ["/api/cash-forecast"],
  "/reconciliation": ["/api/reconciliation"],
  "/anomalies": ["/api/anomalies"],
  "/people-docs": ["/api/people-docs", "/api/people-docs/summary"],
};

function workspaceFromPath(pathname: string): WorkspaceId {
  if (pathname === "/suppliers" || pathname.startsWith("/suppliers/")) return "suppliers";
  if (pathname === "/invoices" || pathname.startsWith("/invoices/")) return "invoices";
  if (pathname === "/people-docs" || pathname.startsWith("/people-docs/")) return "people";
  return "cash";
}

function navActive(pathname: string, href: string): boolean {
  if (href === "/" || href === "/suppliers" || href === "/invoices" || href === "/people-docs") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

const navItemSx = {
  mx: 1,
  borderRadius: 1,
  color: "grey.300",
  "&.Mui-selected": {
    bgcolor: "rgba(255,255,255,0.1)",
    color: "#fff",
    "&:hover": { bgcolor: "rgba(255,255,255,0.14)" },
  },
  "&:hover": { bgcolor: "rgba(255,255,255,0.08)", color: "#fff" },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const workspace = workspaceFromPath(pathname);
  const items = NAV[workspace];
  const hint = WORKSPACES.find((w) => w.id === workspace)?.hint ?? "";
  const fillViewport =
    workspace === "people" ||
    pathname === "/suppliers/records" ||
    pathname === "/suppliers/review";

  return (
    <Box
      sx={{
        display: "flex",
        overflowX: "hidden",
        height: fillViewport ? "100dvh" : undefined,
        minHeight: fillViewport ? undefined : "100vh",
      }}
    >
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            bgcolor: "secondary.main",
            color: "grey.200",
            borderRight: 0,
          },
        }}
      >
        <Toolbar sx={{ gap: 1.5, px: 2.5, minHeight: 88 }}>
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: "primary.light",
              color: "secondary.main",
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            a
          </Avatar>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2, color: "#fff" }}>
              aggcenter
            </Typography>
            <Typography variant="caption" sx={{ color: "grey.500" }}>
              Aggregation Center
            </Typography>
          </Box>
        </Toolbar>

        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={workspace}
            onChange={(_, next: WorkspaceId | null) => {
              if (!next || next === workspace) return;
              const home = WORKSPACES.find((w) => w.id === next)?.home;
              if (home) router.push(home);
            }}
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              bgcolor: "rgba(255,255,255,0.06)",
              p: 0.5,
              "& .MuiToggleButton-root": {
                color: "grey.400",
                border: 0,
                borderRadius: "8px !important",
                py: 0.75,
              },
              "& .Mui-selected": {
                bgcolor: "rgba(255,255,255,0.14) !important",
                color: "#fff !important",
              },
            }}
          >
            {WORKSPACES.map((ws) => (
              <ToggleButton key={ws.id} value={ws.id}>
                {ws.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        <List disablePadding sx={{ flex: 1 }}>
          {items.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={navActive(pathname, item.href)}
            />
          ))}
          <ListSubheader
            disableSticky
            sx={{
              bgcolor: "transparent",
              color: "grey.500",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              mt: 1.5,
            }}
          >
            Platform
          </ListSubheader>
          {SHARED.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={navActive(pathname, item.href)}
            />
          ))}
        </List>
        <Box sx={{ px: 3, py: 2 }}>
          <Typography variant="caption" sx={{ color: "grey.500" }}>
            {workspace === "cash"
              ? `Cash Position · ${hint}`
              : workspace === "suppliers"
                ? `Suppliers · ${hint}`
                : workspace === "people"
                  ? `People · ${hint}`
                  : `Invoices · ${hint}`}
          </Typography>
        </Box>
      </Drawer>

      <Box
        sx={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          flexDirection: "column",
          minHeight: fillViewport ? 0 : undefined,
        }}
      >
        <AppBar
          position="static"
          color="inherit"
          elevation={0}
          sx={{
            display: { md: "none" },
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Toolbar sx={{ gap: 1, minHeight: 56 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              aggcenter
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={workspace}
              onChange={(_, next: WorkspaceId | null) => {
                if (!next) return;
                const home = WORKSPACES.find((w) => w.id === next)?.home;
                if (home) router.push(home);
              }}
              sx={{ ml: "auto" }}
            >
              {WORKSPACES.map((ws) => (
                <ToggleButton key={ws.id} value={ws.id} component={Link} href={ws.home}>
                  {ws.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Toolbar>
        </AppBar>
        <Box
          component="main"
          sx={{
            minWidth: 0,
            flex: 1,
            px: { xs: 2, sm: 3, lg: 4 },
            py: fillViewport ? 2 : 3,
            display: fillViewport ? "flex" : undefined,
            flexDirection: fillViewport ? "column" : undefined,
            minHeight: fillViewport ? 0 : undefined,
            overflow: fillViewport ? "hidden" : "hidden auto",
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <ListItemButton
      component={Link}
      href={href}
      selected={active}
      onMouseEnter={() => {
        for (const url of PREFETCH_APIS[href] ?? []) prefetchFetch(url);
      }}
      onFocus={() => {
        for (const url of PREFETCH_APIS[href] ?? []) prefetchFetch(url);
      }}
      sx={navItemSx}
    >
      <ListItemIcon sx={{ color: "inherit", minWidth: 36 }}>{icon}</ListItemIcon>
      <ListItemText
        primary={label}
        slotProps={{ primary: { sx: { fontSize: 14, fontWeight: 600 } } }}
      />
    </ListItemButton>
  );
}
