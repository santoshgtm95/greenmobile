import type { ReactNode } from "react";
import { Box, ButtonBase, Paper, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import StorefrontOutlinedIcon from "@mui/icons-material/StorefrontOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import DevicesOutlinedIcon from "@mui/icons-material/DevicesOutlined";
import BackupOutlinedIcon from "@mui/icons-material/BackupOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { compactPageSx } from "../components/compactSx";
import { PageHeader } from "../components/PageLayout";
import SystemInfoPage from "./SystemInfoPage";
import BackupPanel from "./BackupPanel";
import ShopPanel from "./settings/ShopPanel";
import MoneyPanel from "./settings/MoneyPanel";
import DocumentsPanel from "./settings/DocumentsPanel";
import PrintingPanel from "./settings/PrintingPanel";
import StockPanel from "./settings/StockPanel";
import DataControlPanel from "./settings/DataControlPanel";
import NetworkPanel from "./settings/NetworkPanel";
import type { Permission } from "@shared/domain";

/**
 * Settings (spec §58–§62, §67).
 *
 * Everything configurable about the installation, grouped rather than spread
 * across the navigation. The section is in the route rather than in component
 * state, so /settings/printing is a real address — reachable from a link, from
 * the back button, and from the screenshot harness.
 *
 * Each section states the permission it needs. Some settings are readable by a
 * manager (they hold settings.view) and some are not: `settings:getAll` returns
 * only the non-sensitive keys to a non-administrator, so a section whose fields
 * would all come back blank is hidden instead of shown empty.
 */
const TABS = [
  { value: "shop", label: "Shop", hint: "Name and details on receipts", icon: <StorefrontOutlinedIcon />, permission: "settings.view" },
  { value: "money", label: "Currency & Tax", hint: "How prices and tax work", icon: <PaymentsOutlinedIcon />, permission: "settings.view" },
  { value: "stock", label: "Stock", hint: "Low stock and selling below zero", icon: <Inventory2OutlinedIcon />, permission: "settings.view" },
  { value: "printing", label: "Printing", hint: "Receipt printer and roll width", icon: <PrintOutlinedIcon />, permission: "settings.manage" },
  { value: "documents", label: "Numbering", hint: "Invoice and job number prefixes", icon: <FormatListNumberedIcon />, permission: "settings.manage" },
  { value: "network", label: "Other Devices", hint: "Use the POS on the shop Wi-Fi", icon: <DevicesOutlinedIcon />, permission: "settings.manage" },
  { value: "backup", label: "Backup & Restore", hint: "Keep a copy of your data safe", icon: <BackupOutlinedIcon />, permission: "backup.manage" },
  //{ value: 'data', label: 'Data Control', permission: 'backup.manage' },
  { value: "system", label: "System", hint: "Version, data folder and health", icon: <InfoOutlinedIcon />, permission: "settings.view" },
] as const satisfies ReadonlyArray<{
  value: string;
  label: string;
  hint: string;
  icon: ReactNode;
  permission: Permission;
}>;

type TabValue = (typeof TABS)[number]["value"];

export default function SettingsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();

  const visible = TABS.filter((entry) => can(entry.permission));
  const active: TabValue = visible.some((entry) => entry.value === tab)
    ? (tab as TabValue)
    : (visible[0]?.value ?? "system");

  return (
    <Stack spacing={2} sx={compactPageSx}>
      <PageHeader title="Settings" subtitle="How this shop's POS is set up. Changes apply to every till once saved." />

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "250px minmax(0, 1fr)" }, alignItems: "start" }}>
        {/* Section list: stays in view while a long section scrolls. */}
        <Paper
          component="nav"
          aria-label="Settings sections"
          sx={{
            p: 0.75,
            borderRadius: 3,
            border: "1px solid",
            borderColor: "divider",
            position: { md: "sticky" },
            top: { md: 16 },
          }}
        >
          <Stack spacing={0.25}>
            {visible.map((entry) => {
              const selected = entry.value === active;
              return (
                <ButtonBase
                  key={entry.value}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => navigate(`/settings/${entry.value}`)}
                  sx={(theme) => ({
                    display: "flex",
                    gap: 1.25,
                    alignItems: "center",
                    justifyContent: "flex-start",
                    textAlign: "left",
                    px: 1,
                    py: 0.85,
                    borderRadius: 2,
                    bgcolor: selected ? alpha(theme.palette.primary.main, 0.1) : "transparent",
                    transition: "background-color .15s",
                    "&:hover": { bgcolor: selected ? alpha(theme.palette.primary.main, 0.14) : "action.hover" },
                    "&.Mui-focusVisible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
                  })}
                >
                  <Box
                    sx={(theme) => ({
                      width: 32,
                      height: 32,
                      flexShrink: 0,
                      borderRadius: 2,
                      display: "grid",
                      placeItems: "center",
                      color: selected ? "primary.contrastText" : "text.secondary",
                      bgcolor: selected ? "primary.main" : alpha(theme.palette.text.primary, 0.05),
                      transition: "background-color .15s, color .15s",
                      "& svg": { fontSize: 18 },
                    })}
                  >
                    {entry.icon}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ fontWeight: selected ? 700 : 600, color: selected ? "primary.main" : "text.primary" }}
                    >
                      {entry.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {entry.hint}
                    </Typography>
                  </Box>
                </ButtonBase>
              );
            })}
          </Stack>
        </Paper>

        <Box sx={{ minWidth: 0 }}>
          {active === "shop" && <ShopPanel />}
          {active === "money" && <MoneyPanel />}
          {active === "stock" && <StockPanel />}
          {active === "printing" && <PrintingPanel />}
          {active === "documents" && <DocumentsPanel />}
          {active === "network" && <NetworkPanel />}
          {active === "backup" && <BackupPanel />}
          {/* {active === "data" && <DataControlPanel />} */}
          {active === "system" && <SystemInfoPage />}
        </Box>
      </Box>
    </Stack>
  );
}
