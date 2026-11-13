import { useState, type ReactNode } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, keyframes } from "@mui/material/styles";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import PeopleIcon from "@mui/icons-material/People";
import BuildIcon from "@mui/icons-material/Build";
import PaymentsIcon from "@mui/icons-material/Payments";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import { NavLink, useLocation } from "react-router-dom";
import Logo from "../components/Logo";
import { useAuth } from "../hooks/useAuth";
import { useSettings } from "../hooks/useSettings";
import { USER_ROLE_LABELS, type Permission } from "@shared/domain";

const DRAWER_WIDTH = 232;

const slideIn = keyframes`
  from { opacity: 0; transform: translateX(-14px); }
  to { opacity: 1; transform: none; }
`;
const pop = keyframes`
  from { opacity: 0; transform: scale(0.6) rotate(-12deg); }
  to { opacity: 1; transform: none; }
`;
const rise = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
`;
const dropIn = keyframes`
  from { opacity: 0; transform: translateY(-100%); }
  to { opacity: 1; transform: none; }
`;
const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6); }
  70% { box-shadow: 0 0 0 7px rgba(74, 222, 128, 0); }
  100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
`;

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  /** Hidden when the signed-in role lacks this. */
  permission: Permission;
}

/** Main navigation (spec §71). */
const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    to: "/",
    icon: <DashboardIcon />,
    permission: "sales.view",
  },
  {
    label: "POS",
    to: "/pos",
    icon: <PointOfSaleIcon />,
    permission: "pos.sell",
  },
  {
    label: "Sales",
    to: "/sales",
    icon: <ReceiptLongIcon />,
    permission: "sales.view",
  },
  {
    label: "Stocks",
    to: "/stocks",
    icon: <Inventory2Icon />,
    permission: "products.view",
  },
  {
    label: "Purchase Invoice",
    to: "/purchases",
    icon: <LocalShippingIcon />,
    permission: "products.view",
  },
  {
    label: "Customers",
    to: "/customers",
    icon: <PeopleIcon />,
    permission: "customers.view",
  },
  {
    label: "Services",
    to: "/services",
    icon: <BuildIcon />,
    permission: "services.view",
  },
  {
    label: "Expenses",
    to: "/expenses",
    icon: <PaymentsIcon />,
    permission: "expenses.view",
  },
  {
    label: "Banking",
    to: "/banking",
    icon: <AccountBalanceIcon />,
    permission: "banking.view",
  },
  {
    label: "Reports",
    to: "/reports",
    icon: <AssessmentIcon />,
    permission: "reports.view",
  },
  {
    label: "Users",
    to: "/users",
    icon: <ManageAccountsIcon />,
    permission: "users.view",
  },
  {
    label: "Settings",
    to: "/settings",
    icon: <SettingsIcon />,
    permission: "settings.view",
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, can, logout } = useAuth();
  const { data: settings } = useSettings();
  const location = useLocation();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const visibleItems = NAV_ITEMS.filter((item) => can(item.permission));
  const currentItem = visibleItems.find((item) =>
    item.to === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(item.to),
  );
  const currentLabel = currentItem?.label ?? "Green Mobile";

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Drawer
        variant="permanent"
        sx={(theme) => ({
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            background: `radial-gradient(circle at 0% 0%, ${alpha(theme.palette.primary.main, 0.28)}, transparent 42%), linear-gradient(180deg, #0f1b2d 0%, #0b1524 65%, #08101c 100%)`,
            color: "#e3e8ef",
            borderRight: "1px solid rgba(255,255,255,0.05)",
            "@media (prefers-reduced-motion: reduce)": {
              "& *": { animation: "none !important", transition: "none !important" },
            },
          },
        })}
      >
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ px: 2, py: 2.25, alignItems: "center" }}
        >
          {/* onDark: the logo's grey half is unreadable straight on this navy. */}
          <Box
            sx={(theme) => ({
              display: "flex",
              p: 0.5,
              borderRadius: 2,
              bgcolor: "rgba(255,255,255,0.06)",
              boxShadow: `0 0 18px ${alpha(theme.palette.primary.main, 0.35)}`,
              animation: `${pop} 500ms cubic-bezier(.2,.9,.3,1.3) both`,
              transition: "transform 300ms",
              "&:hover": { transform: "rotate(-8deg) scale(1.06)" },
            })}
          >
            <Logo size={30} onDark />
          </Box>
          <Box sx={{ minWidth: 0, animation: `${slideIn} 450ms 80ms ease-out both` }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
              {settings?.shopName || "Green Mobile"}
            </Typography>
            <Typography variant="caption" sx={{ color: "#8fa3bf" }}>
              Offline Point of Sale
            </Typography>
          </Box>
        </Stack>
        <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

        <Typography
          variant="overline"
          sx={{ px: 2.5, pt: 1.5, color: "#5f7591", fontSize: 10.5, letterSpacing: 1.4 }}
        >
          Menu
        </Typography>
        <List sx={{ px: 1.25, py: 0.5 }}>
          {visibleItems.map((item, index) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.to === "/"}
              sx={(theme) => ({
                position: "relative",
                borderRadius: 2,
                mb: 0.5,
                py: 0.85,
                color: "#c2cede",
                animation: `${slideIn} 420ms ${index * 35}ms ease-out both`,
                transition: "background-color 200ms, color 200ms, transform 200ms, box-shadow 200ms",
                "& .MuiListItemIcon-root": {
                  color: "#8fa3bf",
                  minWidth: 38,
                  transition: "transform 250ms cubic-bezier(.2,.9,.3,1.4), color 200ms",
                },
                // Left indicator bar that grows in on the active item.
                "&::before": {
                  content: '""',
                  position: "absolute",
                  left: -10,
                  top: "50%",
                  width: 4,
                  height: 0,
                  borderRadius: 4,
                  bgcolor: "primary.light",
                  transform: "translateY(-50%)",
                  transition: "height 250ms ease-out",
                },
                "&:hover": {
                  bgcolor: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  transform: "translateX(3px)",
                  "& .MuiListItemIcon-root": { color: "#fff", transform: "scale(1.15)" },
                },
                "&.active": {
                  background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                  color: "#fff",
                  boxShadow: `0 6px 18px ${alpha(theme.palette.primary.main, 0.4)}`,
                  "& .MuiListItemIcon-root": { color: "#fff" },
                  "& .MuiListItemText-primary": { fontWeight: 600 },
                  "&::before": { height: "60%" },
                  "&:hover": { transform: "none" },
                },
                "&.Mui-focusVisible": {
                  outline: `2px solid ${alpha(theme.palette.primary.light, 0.8)}`,
                  outlineOffset: 1,
                },
              })}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                slotProps={{ primary: { sx: { fontSize: 14.5 } } }}
              />
            </ListItemButton>
          ))}
        </List>

        <Box sx={{ mt: "auto", p: 2 }}>
          <Tooltip title="This POS stores all data on this computer and needs no internet connection.">
            <Chip
              icon={<WifiOffIcon sx={{ fontSize: 16 }} />}
              label={
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <span>Works offline</span>
                  <Box
                    component="span"
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      bgcolor: "#4ade80",
                      animation: `${pulse} 2s infinite`,
                    }}
                  />
                </Stack>
              }
              size="small"
              sx={{
                bgcolor: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#c2cede",
                "& .MuiChip-icon": { color: "#8fa3bf" },
              }}
            />
          </Tooltip>
        </Box>
      </Drawer>

      <Box
        sx={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <AppBar
          position="sticky"
          color="inherit"
          elevation={0}
          sx={(theme) => ({
            bgcolor: alpha(theme.palette.background.paper, 0.78),
            backdropFilter: "blur(12px) saturate(160%)",
            animation: `${dropIn} 400ms ease-out both`,
            // Gradient hairline instead of a flat grey border.
            "&::after": {
              content: '""',
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "1px",
              background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.6)}, ${theme.palette.divider} 40%, transparent)`,
            },
            "@media (prefers-reduced-motion: reduce)": {
              "&, & *": { animation: "none !important", transition: "none !important" },
            },
          })}
        >
          <Toolbar sx={{ gap: 2 }}>
            {/* Keyed so the title re-animates on every page change. */}
            <Stack
              key={currentLabel}
              direction="row"
              spacing={1.25}
              sx={{ flexGrow: 1, alignItems: "center", animation: `${slideIn} 350ms ease-out both` }}
            >
              {currentItem && (
                <Box
                  sx={(theme) => ({
                    display: "grid",
                    placeItems: "center",
                    width: 34,
                    height: 34,
                    borderRadius: 2,
                    color: "primary.main",
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    animation: `${pop} 450ms cubic-bezier(.2,.9,.3,1.3) both`,
                    "& svg": { fontSize: 20 },
                  })}
                >
                  {currentItem.icon}
                </Box>
              )}
              <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: -0.2 }}>
                {currentLabel}
              </Typography>
            </Stack>

            {user && (
              <>
                <Box
                  component="button"
                  type="button"
                  aria-label="Account menu"
                  onClick={(e) => setMenuAnchor(e.currentTarget)}
                  sx={(theme) => ({
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    pl: { xs: 0.5, sm: 1.5 },
                    pr: 0.5,
                    py: 0.5,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 99,
                    bgcolor: "background.paper",
                    color: "inherit",
                    font: "inherit",
                    cursor: "pointer",
                    transition: "box-shadow 200ms, border-color 200ms, transform 200ms",
                    "&:hover, &:focus-visible": {
                      borderColor: alpha(theme.palette.primary.main, 0.5),
                      boxShadow: `0 4px 14px ${alpha(theme.palette.primary.main, 0.18)}`,
                      transform: "translateY(-1px)",
                    },
                    "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                  })}
                >
                  <Box
                    sx={{
                      textAlign: "right",
                      display: { xs: "none", sm: "block" },
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, lineHeight: 1.2 }}
                    >
                      {user.fullName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {USER_ROLE_LABELS[user.role]}
                    </Typography>
                  </Box>
                  <Avatar
                    sx={(theme) => ({
                      width: 32,
                      height: 32,
                      fontSize: 14,
                      fontWeight: 700,
                      background: `linear-gradient(135deg, ${theme.palette.primary.light}, ${theme.palette.primary.dark})`,
                      boxShadow: `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 3.5px ${alpha(theme.palette.primary.main, 0.5)}`,
                    })}
                  >
                    {user.fullName.trim().charAt(0).toUpperCase()}
                  </Avatar>
                </Box>
                <Menu
                  anchorEl={menuAnchor}
                  open={Boolean(menuAnchor)}
                  onClose={() => setMenuAnchor(null)}
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  transformOrigin={{ vertical: "top", horizontal: "right" }}
                  slotProps={{ paper: { sx: { mt: 1, borderRadius: 2, minWidth: 180 } } }}
                >
                  <MenuItem
                    onClick={() => {
                      setMenuAnchor(null);
                      void logout();
                    }}
                  >
                    <ListItemIcon>
                      <LogoutIcon fontSize="small" />
                    </ListItemIcon>
                    Sign out
                  </MenuItem>
                </Menu>
              </>
            )}
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          sx={(theme) => ({
            flexGrow: 1,
            p: 3,
            minWidth: 0,
            background: `radial-gradient(circle at 100% 0%, ${alpha(theme.palette.primary.main, 0.06)}, transparent 40%), ${theme.palette.background.default}`,
            // Pages are a Stack of blocks; each block rises in, one after another.
            // A new page mounts new nodes, so this replays on every navigation.
            "& > .MuiStack-root > *, & > .MuiPaper-root": {
              animation: `${rise} 420ms ease-out both`,
            },
            ...Object.fromEntries(
              Array.from({ length: 8 }, (_, i) => [
                `& > .MuiStack-root > :nth-of-type(${i + 1})`,
                { animationDelay: `${i * 60}ms` },
              ]),
            ),
            // Page cards: rounder, with a soft lift on hover.
            "& .MuiPaper-root:not(.MuiAccordion-root)": {
              borderRadius: 3,
              transition: "box-shadow 200ms, border-color 200ms",
            },
            "& .MuiPaper-outlined, & .MuiPaper-root[class*='MuiCard']": {
              "&:hover": { boxShadow: `0 6px 20px ${alpha(theme.palette.primary.main, 0.1)}` },
            },
            "@media (prefers-reduced-motion: reduce)": {
              "& *": { animation: "none !important" },
            },
          })}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
